"use client";

import { useState } from "react";
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
import { useMissionStore } from "@/lib/store/mission-store";
import type { MissionPattern } from "@/lib/types/mission";
import { toast } from "@/components/ui/use-toast";

export function CreateMission() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState<MissionPattern>("parallel");
  const [spacing, setSpacing] = useState(20); // cm
  const [overlap, setOverlap] = useState(10); // %
  const [speed, setSpeed] = useState(30); // cm/s
  const createMission = useMissionStore((s) => s.createMission);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({
        title: "Name erforderlich",
        variant: "destructive",
      });
      return;
    }

    await createMission({
      name: name.trim(),
      gardenPolygonId: "garden-main",
      pattern,
      spacing: spacing / 100, // cm to m
      overlap: overlap / 100, // % to fraction
      speed: speed / 100, // cm/s to m/s
    });

    toast({
      title: "Auftrag erstellt",
      description: `"${name}" wurde angelegt.`,
      variant: "success",
    });

    setName("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" /> Neuer Auftrag
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neuen Mäh-Auftrag erstellen</DialogTitle>
          <DialogDescription>
            Konfiguriere den Mäh-Auftrag und starte ihn anschließend.
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

          {/* Pattern */}
          <div className="space-y-2">
            <Label>Mäh-Muster</Label>
            <Select value={pattern} onValueChange={(v) => setPattern(v as MissionPattern)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="parallel">Parallel (Streifen)</SelectItem>
                <SelectItem value="spiral">Spiral</SelectItem>
                <SelectItem value="zigzag">Zickzack</SelectItem>
              </SelectContent>
            </Select>
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
            <Label>Überlappung: {overlap}%</Label>
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
            <Label>Geschwindigkeit: {speed} cm/s ({(speed / 100).toFixed(1)} m/s)</Label>
            <Slider
              min={10}
              max={100}
              step={5}
              value={[speed]}
              onValueChange={([v]) => setSpeed(v)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleCreate}>Erstellen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
