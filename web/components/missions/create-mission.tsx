"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useMissionStore } from "@/lib/store/mission-store";
import { useZoneStore } from "@/lib/store/zone-store";
import { useGpsStore } from "@/lib/store/gps-store";
import { toast } from "@/components/ui/use-toast";
import { formatDistance, formatDuration } from "@/lib/utils/formatting";
import type { PlanResult } from "@/lib/types/mission";

export function CreateMission() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mowAll, setMowAll] = useState(true);
  const [selectedZoneId, setSelectedZoneId] = useState<string>("");
  const [spacing, setSpacing] = useState(20); // cm
  const [overlap, setOverlap] = useState(10); // %
  const [speed, setSpeed] = useState(30); // cm/s
  const [perimeterPasses, setPerimeterPasses] = useState(2);
  const [angle, setAngle] = useState(0); // degrees
  const [angleIncrement, setAngleIncrement] = useState(45); // degrees

  const [preview, setPreview] = useState<PlanResult | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);

  const createMission = useMissionStore((s) => s.createMission);
  const zones = useZoneStore((s) => s.zones);
  const loadZones = useZoneStore((s) => s.loadZones);
  const zonesLoaded = useZoneStore((s) => s.loaded);
  const gpsLat = useGpsStore((s) => s.latitude);
  const gpsLon = useGpsStore((s) => s.longitude);

  // Load zones if not loaded
  useEffect(() => {
    if (!zonesLoaded) loadZones();
  }, [zonesLoaded, loadZones]);

  // Mowable zones (garden + mow types)
  const mowableZones = zones.filter(
    (z) =>
      z.geometry.type === "Polygon" &&
      (z.properties.zoneType === "garden" || z.properties.zoneType === "mow")
  );

  const zoneIds = mowAll ? ["all"] : selectedZoneId ? [selectedZoneId] : ["all"];

  // Determine start point: dock zone centroid > GPS position > undefined
  const startPoint = (() => {
    const dockZone = zones.find(
      (z) => z.properties.zoneType === "dock" && z.geometry.type === "Polygon"
    );
    if (dockZone) {
      const coords = dockZone.geometry.coordinates as number[][][];
      const ring = coords[0].slice(0, -1); // Remove closing point
      const avgLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
      const avgLon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
      return [avgLat, avgLon] as [number, number];
    }
    if (gpsLat !== null && gpsLon !== null) {
      return [gpsLat, gpsLon] as [number, number];
    }
    return undefined;
  })();

  // Fetch plan preview when params change
  useEffect(() => {
    if (!open) return;

    const timeout = setTimeout(async () => {
      setIsPlanning(true);
      try {
        const res = await fetch("/api/missions/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            zoneIds,
            spacing: spacing / 100,
            overlap: overlap / 100,
            speed: speed / 100,
            perimeterPasses,
            angle,
            startPoint,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setPreview(data);
        }
      } catch {
        // Silent
      }
      setIsPlanning(false);
    }, 500); // Debounce

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, spacing, overlap, speed, perimeterPasses, angle, mowAll, selectedZoneId]);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ title: "Name erforderlich", variant: "destructive" });
      return;
    }

    await createMission({
      name: name.trim(),
      zoneIds,
      spacing: spacing / 100,
      overlap: overlap / 100,
      speed: speed / 100,
      perimeterPasses,
      angle,
      angleIncrement,
      startPoint,
    });

    toast({
      title: "Auftrag erstellt",
      description: `"${name}" mit ${preview?.pathPoints.length ?? 0} Wegpunkten.`,
      variant: "success",
    });

    setName("");
    setPreview(null);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" /> Neuer Auftrag
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neuen Maeh-Auftrag erstellen</DialogTitle>
          <DialogDescription>
            Konfiguriere den Maeh-Auftrag. Der Pfad wird automatisch berechnet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="z.B. Kompletter Garten"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Zone Selection */}
          <div className="space-y-2">
            <Label>Bereich</Label>
            <div className="flex items-center gap-3">
              <Switch
                checked={mowAll}
                onCheckedChange={setMowAll}
                id="mow-all"
              />
              <Label htmlFor="mow-all" className="text-sm font-normal">
                {mowAll ? "Alles maehen" : "Bestimmte Zone"}
              </Label>
            </div>
            {!mowAll && (
              <Select value={selectedZoneId} onValueChange={setSelectedZoneId}>
                <SelectTrigger>
                  <SelectValue placeholder="Zone waehlen..." />
                </SelectTrigger>
                <SelectContent>
                  {mowableZones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.properties.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Perimeter passes */}
          <div className="space-y-2">
            <Label>Aeussere Bahnen: {perimeterPasses}</Label>
            <Slider
              min={0}
              max={5}
              step={1}
              value={[perimeterPasses]}
              onValueChange={([v]) => setPerimeterPasses(v)}
            />
            <p className="text-[10px] text-muted-foreground">
              Randbahnen die vor dem Streifenmuster gefahren werden
            </p>
          </div>

          {/* Stripe angle */}
          <div className="space-y-2">
            <Label>Startwinkel: {angle}°</Label>
            <Slider
              min={0}
              max={355}
              step={5}
              value={[angle]}
              onValueChange={([v]) => setAngle(v)}
            />
          </div>

          {/* Angle increment */}
          <div className="space-y-2">
            <Label>Winkelversatz pro Fahrt: {angleIncrement}°</Label>
            <Slider
              min={0}
              max={90}
              step={5}
              value={[angleIncrement]}
              onValueChange={([v]) => setAngleIncrement(v)}
            />
            <p className="text-[10px] text-muted-foreground">
              Bei jeder Ausfuehrung dreht sich das Streifenmuster um diesen Winkel
            </p>
          </div>

          {/* Spacing */}
          <div className="space-y-2">
            <Label>Bahnabstand: {spacing} cm</Label>
            <Slider
              min={10}
              max={50}
              step={1}
              value={[spacing]}
              onValueChange={([v]) => setSpacing(v)}
            />
          </div>

          {/* Overlap */}
          <div className="space-y-2">
            <Label>Ueberlappung: {overlap}%</Label>
            <Slider
              min={0}
              max={50}
              step={5}
              value={[overlap]}
              onValueChange={([v]) => setOverlap(v)}
            />
          </div>

          {/* Speed */}
          <div className="space-y-2">
            <Label>
              Geschwindigkeit: {speed} cm/s ({(speed / 100).toFixed(1)} m/s)
            </Label>
            <Slider
              min={10}
              max={100}
              step={5}
              value={[speed]}
              onValueChange={([v]) => setSpeed(v)}
            />
          </div>

          {/* Preview stats */}
          {preview && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs font-medium mb-2">
                Berechnung {isPlanning ? "(aktualisiert...)" : ""}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="block font-medium text-foreground">
                    {preview.pathPoints.length}
                  </span>
                  <span className="text-muted-foreground">Wegpunkte</span>
                </div>
                <div>
                  <span className="block font-medium text-foreground">
                    {formatDistance(preview.estimatedDistance)}
                  </span>
                  <span className="text-muted-foreground">Strecke</span>
                </div>
                <div>
                  <span className="block font-medium text-foreground">
                    {formatDuration(preview.estimatedDuration)}
                  </span>
                  <span className="text-muted-foreground">Dauer</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleCreate} disabled={isPlanning}>
            Erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
