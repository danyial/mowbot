"use client";

import { useEffect, useState, useCallback } from "react";
import { Save, RotateCcw, Search, Loader2, MapPin, Crosshair } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/use-toast";
import { useRosStore } from "@/lib/store/ros-store";
import { useImuStore } from "@/lib/store/imu-store";

interface Config {
  connection: {
    rosbridgeUrl: string;
    reconnectInterval: number;
  };
  robot: {
    wheelSeparation: number;
    maxLinearSpeed: number;
    maxAngularSpeed: number;
    mowWidth: number;
  };
  navigation: {
    ntripServer: string;
    ntripMountpoint: string;
    ntripUsername: string;
    ntripPassword: string;
    magneticDeclination: number;
  };
  map: {
    address: string;
    defaultLat: number;
    defaultLon: number;
    defaultZoom: number;
    tileServerUrl: string;
  };
  safety: {
    tiltThreshold: number;
    cmdVelTimeout: number;
    geofencingEnabled: boolean;
    imuRollOffset: number;
    imuPitchOffset: number;
    imuSmoothing: number;
  };
}

const defaultConfig: Config = {
  connection: { rosbridgeUrl: "ws://mower.local:9090", reconnectInterval: 1000 },
  robot: { wheelSeparation: 0.3, maxLinearSpeed: 1.0, maxAngularSpeed: 2.0, mowWidth: 0.2 },
  navigation: { ntripServer: "", ntripMountpoint: "", ntripUsername: "", ntripPassword: "", magneticDeclination: 2.5 },
  map: { address: "", defaultLat: 48.1634, defaultLon: 11.3019, defaultZoom: 18, tileServerUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" },
  safety: { tiltThreshold: 15, cmdVelTimeout: 500, geofencingEnabled: true, imuRollOffset: 0, imuPitchOffset: 0, imuSmoothing: 0.15 },
};

export default function SettingsPage() {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const setRosUrl = useRosStore((s) => s.setUrl);
  const imuSetOffset = useImuStore((s) => s.setOffset);
  const imuCalibrate = useImuStore((s) => s.calibrate);
  const imuSetSmoothing = useImuStore((s) => s.setSmoothingFactor);
  const imuRawRoll = useImuStore((s) => s.rawRoll);
  const imuRawPitch = useImuStore((s) => s.rawPitch);
  const imuRoll = useImuStore((s) => s.roll);
  const imuPitch = useImuStore((s) => s.pitch);
  const imuLastUpdate = useImuStore((s) => s.lastUpdate);

  const fetchConfig = useCallback(async () => {
    try {
      const [configRes, ntripRes] = await Promise.all([
        fetch("/api/config"),
        fetch("/api/ntrip"),
      ]);

      let merged = { ...defaultConfig };

      if (configRes.ok) {
        const data = await configRes.json();
        merged = { ...merged, ...data };
      }

      // Sync NTRIP data from ntrip.env into the config navigation section
      if (ntripRes.ok) {
        const ntrip = await ntripRes.json();
        if (ntrip.host) {
          merged = {
            ...merged,
            navigation: {
              ...merged.navigation,
              ntripServer: `http://${ntrip.host}:${ntrip.port}`,
              ntripMountpoint: ntrip.mountpoint || merged.navigation.ntripMountpoint,
              ntripUsername: ntrip.username || merged.navigation.ntripUsername,
              ntripPassword: ntrip.password || merged.navigation.ntripPassword,
            },
          };
        }
      }

      setConfig(merged);

      // Apply saved IMU calibration offset and smoothing to the store
      if (merged.safety.imuRollOffset || merged.safety.imuPitchOffset) {
        imuSetOffset(merged.safety.imuRollOffset, merged.safety.imuPitchOffset);
      }
      if (merged.safety.imuSmoothing) {
        imuSetSmoothing(merged.safety.imuSmoothing);
      }
    } catch {
      // Use defaults
    }
    setLoading(false);
  }, [imuSetOffset, imuSetSmoothing]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Parse NTRIP server URL into host and port
      let ntripHost = "";
      let ntripPort = 2101;
      try {
        const url = new URL(config.navigation.ntripServer);
        ntripHost = url.hostname;
        ntripPort = parseInt(url.port, 10) || 2101;
      } catch {
        // If URL parsing fails, try raw host:port
        const parts = config.navigation.ntripServer.replace(/^https?:\/\//, "").split(":");
        ntripHost = parts[0] || "";
        ntripPort = parseInt(parts[1], 10) || 2101;
      }

      // Save config and NTRIP settings in parallel
      const [configRes, ntripRes] = await Promise.all([
        fetch("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        }),
        fetch("/api/ntrip", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: ntripHost,
            port: ntripPort,
            mountpoint: config.navigation.ntripMountpoint,
            username: config.navigation.ntripUsername,
            password: config.navigation.ntripPassword,
          }),
        }),
      ]);

      if (configRes.ok) {
        setRosUrl(config.connection.rosbridgeUrl);
      }

      // Check NTRIP result
      let ntripMsg = "";
      if (ntripRes.ok) {
        const ntripResult = await ntripRes.json();
        if (ntripResult.serviceRestarted) {
          ntripMsg = " NTRIP-Service neu gestartet.";
        } else {
          ntripMsg = " NTRIP-Config gespeichert (Service-Neustart fehlgeschlagen).";
        }
      }

      if (configRes.ok) {
        toast({
          title: "Einstellungen gespeichert",
          description: ntripMsg || undefined,
          variant: "success",
        });
      } else {
        throw new Error();
      }
    } catch {
      toast({
        title: "Fehler beim Speichern",
        variant: "destructive",
      });
    }
    setSaving(false);
  };

  const updateConfig = <S extends keyof Config, K extends keyof Config[S]>(
    section: S,
    key: K,
    value: Config[S][K]
  ) => {
    setConfig((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));
  };

  const handleGeocode = async () => {
    const address = config.map.address.trim();
    if (!address) return;

    setGeocoding(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`,
        {
          headers: {
            "Accept": "application/json",
            "User-Agent": "MowerControl/1.0",
          },
        }
      );

      if (!res.ok) throw new Error("Geocoding fehlgeschlagen");

      const results = await res.json();
      if (results.length === 0) {
        toast({
          title: "Adresse nicht gefunden",
          description: "Bitte überprüfe die Eingabe und versuche es erneut.",
          variant: "destructive",
        });
        setGeocoding(false);
        return;
      }

      const { lat, lon, display_name } = results[0];
      const parsedLat = parseFloat(lat);
      const parsedLon = parseFloat(lon);

      setConfig((prev) => ({
        ...prev,
        map: {
          ...prev.map,
          defaultLat: parsedLat,
          defaultLon: parsedLon,
        },
      }));

      toast({
        title: "Koordinaten ermittelt",
        description: `${display_name} → ${parsedLat.toFixed(5)}, ${parsedLon.toFixed(5)}`,
        variant: "success",
      });
    } catch {
      toast({
        title: "Geocoding fehlgeschlagen",
        description: "Nominatim-API nicht erreichbar oder Adresse ungültig.",
        variant: "destructive",
      });
    }
    setGeocoding(false);
  };

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <h2 className="text-lg font-semibold">Einstellungen</h2>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 rounded-lg bg-card animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Einstellungen</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchConfig}>
            <RotateCcw className="h-4 w-4 mr-2" /> Zurücksetzen
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Speichert..." : "Speichern"}
          </Button>
        </div>
      </div>

      {/* Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Verbindung</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>rosbridge URL</Label>
            <Input
              value={config.connection.rosbridgeUrl}
              onChange={(e) =>
                updateConfig("connection", "rosbridgeUrl", e.target.value)
              }
              placeholder="ws://mower.local:9090"
            />
          </div>
          <div className="space-y-2">
            <Label>Reconnect-Intervall: {config.connection.reconnectInterval}ms</Label>
            <Slider
              min={500}
              max={10000}
              step={500}
              value={[config.connection.reconnectInterval]}
              onValueChange={([v]) =>
                updateConfig("connection", "reconnectInterval", v)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Robot */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Roboter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Kettenabstand (m)</Label>
              <Input
                type="number"
                step="0.01"
                value={config.robot.wheelSeparation}
                onChange={(e) =>
                  updateConfig("robot", "wheelSeparation", parseFloat(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Mähwerk-Breite (m)</Label>
              <Input
                type="number"
                step="0.01"
                value={config.robot.mowWidth}
                onChange={(e) =>
                  updateConfig("robot", "mowWidth", parseFloat(e.target.value) || 0)
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Max Linear: {config.robot.maxLinearSpeed} m/s</Label>
            <Slider
              min={10}
              max={200}
              step={5}
              value={[config.robot.maxLinearSpeed * 100]}
              onValueChange={([v]) =>
                updateConfig("robot", "maxLinearSpeed", v / 100)
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Max Angular: {config.robot.maxAngularSpeed} rad/s</Label>
            <Slider
              min={50}
              max={500}
              step={10}
              value={[config.robot.maxAngularSpeed * 100]}
              onValueChange={([v]) =>
                updateConfig("robot", "maxAngularSpeed", v / 100)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Navigation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>NTRIP-Server URL</Label>
            <Input
              value={config.navigation.ntripServer}
              onChange={(e) =>
                updateConfig("navigation", "ntripServer", e.target.value)
              }
              placeholder="http://ntrip.example.com:2101"
            />
          </div>
          <div className="space-y-2">
            <Label>Mountpoint</Label>
            <Input
              value={config.navigation.ntripMountpoint}
              onChange={(e) =>
                updateConfig("navigation", "ntripMountpoint", e.target.value)
              }
              placeholder="RTCM3_IMAX"
            />
          </div>
          <div className="space-y-2">
            <Label>Benutzername</Label>
            <Input
              value={config.navigation.ntripUsername}
              onChange={(e) =>
                updateConfig("navigation", "ntripUsername", e.target.value)
              }
              placeholder="NTRIP Benutzername"
            />
          </div>
          <div className="space-y-2">
            <Label>Passwort</Label>
            <Input
              type="password"
              value={config.navigation.ntripPassword}
              onChange={(e) =>
                updateConfig("navigation", "ntripPassword", e.target.value)
              }
              placeholder="NTRIP Passwort"
            />
          </div>
          <div className="space-y-2">
            <Label>
              Magnetic Declination: {config.navigation.magneticDeclination}°
            </Label>
            <Slider
              min={-30}
              max={30}
              step={0.5}
              value={[config.navigation.magneticDeclination]}
              onValueChange={([v]) =>
                updateConfig("navigation", "magneticDeclination", v)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Map */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Karte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Address + Geocoding */}
          <div className="space-y-2">
            <Label>Adresse</Label>
            <div className="flex gap-2">
              <Input
                value={config.map.address}
                onChange={(e) =>
                  updateConfig("map", "address", e.target.value)
                }
                placeholder="z.B. Musterstraße 1, 82223 Eichenau"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleGeocode();
                  }
                }}
              />
              <Button
                variant="secondary"
                onClick={handleGeocode}
                disabled={geocoding || !config.map.address.trim()}
                className="shrink-0"
              >
                {geocoding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Adresse eingeben und Suche klicken, um die Kartenposition zu setzen.
            </p>
          </div>

          {/* Coordinates display */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Breitengrad (Lat)</Label>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  type="number"
                  step="0.0000001"
                  value={config.map.defaultLat}
                  onChange={(e) =>
                    updateConfig("map", "defaultLat", parseFloat(e.target.value) || 0)
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Längengrad (Lon)</Label>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  type="number"
                  step="0.0000001"
                  value={config.map.defaultLon}
                  onChange={(e) =>
                    updateConfig("map", "defaultLon", parseFloat(e.target.value) || 0)
                  }
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Default Zoom: {config.map.defaultZoom}</Label>
            <Slider
              min={10}
              max={22}
              step={1}
              value={[config.map.defaultZoom]}
              onValueChange={([v]) => updateConfig("map", "defaultZoom", v)}
            />
          </div>
          <div className="space-y-2">
            <Label>Tile-Server URL</Label>
            <Input
              value={config.map.tileServerUrl}
              onChange={(e) =>
                updateConfig("map", "tileServerUrl", e.target.value)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Safety */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Sicherheit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Kipp-Schwellenwert: {config.safety.tiltThreshold}°</Label>
            <Slider
              min={5}
              max={45}
              step={1}
              value={[config.safety.tiltThreshold]}
              onValueChange={([v]) =>
                updateConfig("safety", "tiltThreshold", v)
              }
            />
          </div>
          <div className="space-y-2">
            <Label>cmd_vel Timeout: {config.safety.cmdVelTimeout}ms</Label>
            <Slider
              min={100}
              max={2000}
              step={100}
              value={[config.safety.cmdVelTimeout]}
              onValueChange={([v]) =>
                updateConfig("safety", "cmdVelTimeout", v)
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Geofencing aktiv</Label>
            <Switch
              checked={config.safety.geofencingEnabled}
              onCheckedChange={(checked) =>
                updateConfig("safety", "geofencingEnabled", checked)
              }
            />
          </div>

          {/* IMU Smoothing */}
          <div className="space-y-2 border-t border-border pt-4">
            <Label>
              IMU-Glättung: {Math.round(config.safety.imuSmoothing * 100)}%
              {config.safety.imuSmoothing <= 0.1 ? " (sehr glatt)" : config.safety.imuSmoothing >= 0.5 ? " (wenig Glättung)" : ""}
            </Label>
            <Slider
              min={5}
              max={100}
              step={5}
              value={[Math.round(config.safety.imuSmoothing * 100)]}
              onValueChange={([v]) => {
                const alpha = v / 100;
                updateConfig("safety", "imuSmoothing", alpha);
                imuSetSmoothing(alpha);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Niedrig = glatter (träger), Hoch = reaktionsschneller (rauschiger)
            </p>
          </div>

          {/* IMU Calibration */}
          <div className="space-y-3 border-t border-border pt-4">
            <Label>IMU-Kalibrierung</Label>
            <p className="text-xs text-muted-foreground">
              Stelle den Roboter auf eine ebene Fläche und drücke &quot;Kalibrieren&quot;.
              Die aktuelle Neigung wird als Nullpunkt gespeichert.
            </p>

            {/* Live IMU values */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-xs text-muted-foreground">Aktuell (korrigiert)</span>
                <div className="font-mono">
                  Roll: {imuLastUpdate > 0 ? `${imuRoll.toFixed(1)}°` : "--"}
                </div>
                <div className="font-mono">
                  Pitch: {imuLastUpdate > 0 ? `${imuPitch.toFixed(1)}°` : "--"}
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Roh (unkorrigiert)</span>
                <div className="font-mono">
                  Roll: {imuLastUpdate > 0 ? `${imuRawRoll.toFixed(1)}°` : "--"}
                </div>
                <div className="font-mono">
                  Pitch: {imuLastUpdate > 0 ? `${imuRawPitch.toFixed(1)}°` : "--"}
                </div>
              </div>
            </div>

            {/* Current offset */}
            <div className="text-xs text-muted-foreground">
              Gespeicherter Offset: Roll {config.safety.imuRollOffset.toFixed(1)}° / Pitch {config.safety.imuPitchOffset.toFixed(1)}°
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={imuLastUpdate === 0 || calibrating}
                onClick={() => {
                  setCalibrating(true);
                  imuCalibrate();
                  // Update config with new offset values
                  const store = useImuStore.getState();
                  updateConfig("safety", "imuRollOffset", store.rollOffset);
                  updateConfig("safety", "imuPitchOffset", store.pitchOffset);
                  toast({
                    title: "IMU kalibriert",
                    description: `Offset: Roll ${store.rollOffset.toFixed(1)}° / Pitch ${store.pitchOffset.toFixed(1)}°`,
                    variant: "success",
                  });
                  setCalibrating(false);
                }}
              >
                <Crosshair className="h-4 w-4 mr-2" />
                Kalibrieren
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  imuSetOffset(0, 0);
                  updateConfig("safety", "imuRollOffset", 0);
                  updateConfig("safety", "imuPitchOffset", 0);
                  toast({
                    title: "Kalibrierung zurückgesetzt",
                    variant: "default",
                  });
                }}
              >
                Zurücksetzen
              </Button>
            </div>

            {imuLastUpdate === 0 && (
              <p className="text-xs text-yellow-500">
                Keine IMU-Daten verfügbar. Verbinde den Sensor um zu kalibrieren.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
