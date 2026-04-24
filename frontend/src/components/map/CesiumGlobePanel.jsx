/* eslint-disable react-hooks/immutability */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Viewer, Entity } from "resium";
import {
  Cartesian3, Color, HeightReference, Ion,
  Math as CesiumMath, VerticalOrigin, PolylineGlowMaterialProperty,
  Transforms, HeadingPitchRoll, UrlTemplateImageryProvider,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useSentinelStore } from "../../store/useSentinelStore";

if (import.meta?.env?.VITE_CESIUM_ION_TOKEN) {
  Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
}

const THEME_COLORS = {
  normal: {
    aircraft: { air: "#00d4ff", ground: "#336688" }, ships: "#00ff88",
    satellites: "#a78bfa",
    eq: (m) => m>=6?"#ff2244":m>=5?"#ff6600":m>=4?"#ffaa00":"#ffdd44",
    weather: (s) => s==="extreme"?"#ff3366":s==="severe"?"#ffaa00":s==="moderate"?"#a78bfa":"#64748b",
    news: "#00d4ff", threats: "#ff3366",
    wildfires: "#ff6b35",
  },
  nvg: {
    aircraft: { air: "#39ff14", ground: "#1a7a00" }, ships: "#00ff44",
    satellites: "#88ff44", eq: () => "#39ff14", weather: () => "#00cc00",
    news: "#44ff88", threats: "#ffff00", wildfires: "#39ff14",
  },
  flir: {
    aircraft: { air: "#ff6600", ground: "#ff3300" }, ships: "#ffaa00",
    satellites: "#ff4400", eq: () => "#ff2200", weather: () => "#ff8800",
    news: "#ffcc00", threats: "#ff0000", wildfires: "#ff3300",
  },
  crt: {
    aircraft: { air: "#00ff88", ground: "#007744" }, ships: "#00ffaa",
    satellites: "#00ff66", eq: () => "#00ff44", weather: () => "#00cc44",
    news: "#00ffcc", threats: "#ff4488", wildfires: "#ffaa00",
  },
  noir: {
    aircraft: { air: "#ffffff", ground: "#888888" }, ships: "#cccccc",
    satellites: "#aaaaaa", eq: () => "#ffffff", weather: () => "#aaaaaa",
    news: "#dddddd", threats: "#ff4444", wildfires: "#ffffff",
  },
};

function clamp(lon, lat) {
  const clampedLat = Math.max(-85, Math.min(85, lat));
  let clampedLon = ((lon + 180) % 360 + 360) % 360 - 180;
  return [clampedLon, clampedLat];
}

// SVG data URL — heading rotasyonu CSS transform ile
function aircraftDataUrl(color, headingDeg) {
  const h = headingDeg || 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <g transform="translate(16,16) rotate(${h})">
      <polygon points="0,-13 3,-3 11,2 3,1 2,7 5,9 2,9 0,6 -2,9 -5,9 -2,7 -3,1 -11,2 -3,-3"
        fill="${color}" stroke="#0d1424" stroke-width="1"/>
    </g>
  </svg>`;
  return "data:image/svg+xml;base64," + btoa(svg);
}

function shipDataUrl(color, headingDeg) {
  const h = headingDeg || 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
    <g transform="translate(14,14) rotate(${h})">
      <polygon points="0,-11 5,3 5,7 -5,7 -5,3" fill="${color}" stroke="#0d1424" stroke-width="1"/>
      <rect x="-2" y="-11" width="4" height="5" fill="${color}" stroke="#0d1424" stroke-width="1"/>
    </g>
  </svg>`;
  return "data:image/svg+xml;base64," + btoa(svg);
}

// Decimal derece → DMS string
function toDMS(deg, posChar, negChar) {
  const d = Math.abs(deg);
  const dInt = Math.floor(d);
  const mAll = (d - dInt) * 60;
  const mInt = Math.floor(mAll);
  const sec = ((mAll - mInt) * 60).toFixed(2).padStart(5, "0");
  const dir = deg >= 0 ? posChar : negChar;
  return `${String(dInt).padStart(2, "0")} ${String(mInt).padStart(2, "0")} ${sec} ${dir}`;
}

export default function CesiumGlobePanel() {
  const viewerRef = useRef(null);
  const [cameraHeight, setCameraHeight] = useState(18_000_000);
  const [mouseCoords, setMouseCoords] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const radarLayerRef = useRef(null);
  const satLayerRef = useRef(null);

  const {
    aircraft, ships, satellites, persons, earthquakes,
    weatherAlerts, news, threats, wildfires, cameras, conflicts, cyberIocs, gpsJamming, activeLayers, mapTheme, routeOpsOverlay, selectedPersonId,
  } = useSentinelStore();

  const palette = THEME_COLORS[mapTheme] || THEME_COLORS.normal;

  const resolvePickedDetail = useCallback((rawId) => {
    if (!rawId || typeof rawId !== "string") return null;
    const [kind, entityId] = rawId.split(":");
    if (!kind || !entityId) return null;

    if (kind === "ac") {
      const row = (aircraft || []).find((x) => String(x.id) === entityId);
      if (!row) return null;
      return {
        title: row.callsign || row.id || "Aircraft",
        subtitle: "AIRCRAFT",
        lines: [
          `Country: ${row.country || "Unknown"}`,
          `Speed: ${row.speed || 0} km/h`,
          `Alt: ${Math.round(Number(row.altitude || 0)).toLocaleString()} m`,
          `Heading: ${row.heading || 0}°`,
          `Lat/Lon: ${Number(row.latitude || 0).toFixed(3)}, ${Number(row.longitude || 0).toFixed(3)}`,
        ],
      };
    }
    if (kind === "ship") {
      const row = (ships || []).find((x) => String(x.id) === entityId);
      if (!row) return null;
      return {
        title: row.name || row.mmsi || "Ship",
        subtitle: "MARITIME",
        lines: [
          `Flag: ${row.flag || row.country || "Unknown"}`,
          `Type: ${row.ship_type || row.type || "Unknown"}`,
          `Speed: ${row.speed || 0} kn`,
          `Heading: ${row.heading || 0}°`,
          `Lat/Lon: ${Number(row.latitude || 0).toFixed(3)}, ${Number(row.longitude || 0).toFixed(3)}`,
        ],
      };
    }
    if (kind === "th") {
      const row = (threats || []).find((x) => String(x.id) === entityId);
      if (!row) return null;
      return {
        title: row.ip || "Threat",
        subtitle: "CYBER THREAT",
        lines: [
          `Malware: ${row.malware || "-"}`,
          `Country: ${row.country || "-"}`,
          `AS: ${row.as_name || "-"}`,
          `First seen: ${String(row.first_seen || "-").slice(0, 19)}`,
        ],
      };
    }
    if (kind === "news") {
      const row = (news || []).find((x) => String(x.id) === entityId);
      if (!row) return null;
      return {
        title: (row.title || "News").slice(0, 110),
        subtitle: "OSINT NEWS",
        lines: [
          `Source: ${row.source || "-"}`,
          `Country: ${(row.country || "-").toString().toUpperCase()}`,
          `Seen: ${String(row.seendate || "-").slice(0, 19)}`,
          row.url ? `URL: ${row.url}` : "URL: -",
        ],
      };
    }
    if (kind === "cf") {
      const row = (conflicts || []).find((x) => String(x.id) === entityId);
      if (!row) return null;
      return {
        title: (row.title || "Conflict event").slice(0, 120),
        subtitle: "CONFLICT EVENT",
        lines: [
          `Source: ${row.source || "-"}`,
          `Country: ${row.country || "-"}`,
          `Mentions: ${row.mention_count ?? "-"}`,
          `Tone: ${row.tone ?? "-"}`,
          row.url ? `URL: ${row.url}` : "URL: -",
        ],
      };
    }
    if (kind === "ioc") {
      const row = (cyberIocs || []).find((x) => String(x.id) === entityId);
      if (!row) return null;
      return {
        title: row.host || "IOC",
        subtitle: "CYBER IOC",
        lines: [
          `Payload: ${row.payload || "-"}`,
          `Tags: ${row.tags || "-"}`,
          `Date: ${String(row.date_added || "-").slice(0, 19)}`,
          row.url ? `URL: ${row.url}` : "URL: -",
        ],
      };
    }
    return null;
  }, [aircraft, ships, threats, news, conflicts, cyberIocs]);

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;
    viewer.scene.globe.enableLighting = false;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.fog.enabled = true;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(20, 20, 18_000_000),
      orientation: { heading: CesiumMath.toRadians(0), pitch: CesiumMath.toRadians(-90), roll: 0 },
    });
    const handler = () => {
      const h = viewer.camera.positionCartographic?.height ?? 18_000_000;
      setCameraHeight(h);
    };
    viewer.camera.changed.addEventListener(handler);

    // Mouse koordinat takibi
    let mouseHandler = null;
    import("cesium").then(({ ScreenSpaceEventHandler, ScreenSpaceEventType, Ellipsoid }) => {
      mouseHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      mouseHandler.setInputAction((e) => {
        try {
          const ray = viewer.camera.getPickRay(e.endPosition);
          if (!ray) return;
          const pos = viewer.scene.globe.pick(ray, viewer.scene);
          if (!pos) { setMouseCoords(null); return; }
          const carto = Ellipsoid.WGS84.cartesianToCartographic(pos);
          if (!carto) return;
          setMouseCoords({
            lat: CesiumMath.toDegrees(carto.latitude),
            lon: CesiumMath.toDegrees(carto.longitude),
          });
        } catch {
          // no-op
        }
      }, ScreenSpaceEventType.MOUSE_MOVE);

      mouseHandler.setInputAction((e) => {
        try {
          const picked = viewer.scene.pick(e.position);
          const rawId = picked?.id?.id || picked?.id?._id || null;
          if (!rawId) {
            setSelectedDetail(null);
            return;
          }
          setSelectedDetail(resolvePickedDetail(rawId));
        } catch {
          // no-op
        }
      }, ScreenSpaceEventType.LEFT_CLICK);
    });

    // Locations bar fly-to — App.jsx'ten çağrılır
    window.__sentinelFlyTo = (lon, lat, alt = 800_000) => {
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(lon, lat, alt),
        duration: 2,
      });
    };

    return () => {
      viewer.camera.changed.removeEventListener(handler);
      mouseHandler?.destroy();
      delete window.__sentinelFlyTo;
    };
  }, [resolvePickedDetail]);

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;

    const apply = (layer, cfg) => {
      layer.brightness = cfg.brightness;
      layer.contrast = cfg.contrast;
      layer.saturation = cfg.saturation;
      layer.hue = cfg.hue;
      layer.gamma = cfg.gamma;
      layer.alpha = cfg.alpha;
    };

    const cfg =
      mapTheme === "nvg"
        ? { brightness: 0.7, contrast: 1.35, saturation: 0.1, hue: 0.0, gamma: 1.0, alpha: 1.0 }
        : mapTheme === "flir"
        ? { brightness: 0.85, contrast: 1.75, saturation: 0.0, hue: 0.05, gamma: 1.15, alpha: 1.0 }
        : mapTheme === "crt"
        ? { brightness: 0.9, contrast: 1.25, saturation: 0.75, hue: 0.0, gamma: 1.05, alpha: 1.0 }
        : mapTheme === "noir"
        ? { brightness: 0.85, contrast: 1.6, saturation: 0.0, hue: 0.0, gamma: 1.1, alpha: 1.0 }
        : { brightness: 1.0, contrast: 1.0, saturation: 1.0, hue: 0.0, gamma: 1.0, alpha: 1.0 };

    // Apply to all imagery layers (world texture)
    const layers = viewer.imageryLayers;
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers.get(i);
      if (!layer) continue;
      apply(layer, cfg);
    }

    // Atmosphere & globe tint (subtle, theme dependent)
    if (viewer.scene?.skyAtmosphere) {
      viewer.scene.skyAtmosphere.hueShift =
        mapTheme === "nvg" ? -0.25 :
        mapTheme === "flir" ? 0.15 :
        mapTheme === "crt" ? -0.05 :
        mapTheme === "noir" ? 0.0 :
        0.0;
      viewer.scene.skyAtmosphere.saturationShift =
        mapTheme === "nvg" ? -0.6 :
        mapTheme === "flir" ? -0.9 :
        mapTheme === "noir" ? -1.0 :
        0.0;
      viewer.scene.skyAtmosphere.brightnessShift =
        mapTheme === "nvg" ? -0.15 :
        mapTheme === "flir" ? -0.05 :
        mapTheme === "noir" ? -0.1 :
        0.0;
    }

    viewer.scene.globe.baseColor =
      mapTheme === "nvg" ? Color.fromCssColorString("#04110a") :
      mapTheme === "flir" ? Color.fromCssColorString("#120703") :
      mapTheme === "crt" ? Color.fromCssColorString("#071018") :
      mapTheme === "noir" ? Color.fromCssColorString("#0b0f18") :
      Color.fromCssColorString("#0a0e1a");
  }, [mapTheme]);

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;

    const removeLayer = (ref) => {
      const layer = ref.current;
      if (!layer) return;
      try {
        viewer.imageryLayers.remove(layer, true);
      } catch {
        // no-op
      }
      ref.current = null;
    };

    const addOrReplaceRadar = async () => {
      removeLayer(radarLayerRef);
      // RainViewer provides timestamps for radar tiles
      try {
        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        const raw = await res.json();
        const past = raw?.radar?.past;
        const nowcast = raw?.radar?.nowcast;
        const entry = (Array.isArray(nowcast) && nowcast[nowcast.length - 1]) || (Array.isArray(past) && past[past.length - 1]);
        const t = entry?.time;
        if (!t) return;
        const url = `https://tilecache.rainviewer.com/v2/radar/${t}/256/{z}/{x}/{y}/2/1_1.png`;
        const provider = new UrlTemplateImageryProvider({
          url,
          tilingScheme: undefined,
          maximumLevel: 10,
        });
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        layer.alpha = 0.6;
        radarLayerRef.current = layer;
      } catch {
        // best-effort
      }
    };

    const addOrReplaceSat = () => {
      removeLayer(satLayerRef);
      // NASA GIBS (keyless). Use daily TrueColor for current UTC date.
      const d = new Date();
      const iso = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
      const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${iso}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
      try {
        const provider = new UrlTemplateImageryProvider({ url, maximumLevel: 9 });
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        layer.alpha = 0.55;
        satLayerRef.current = layer;
      } catch {
        // no-op
      }
    };

    let timer = null;

    if (activeLayers.radarOverlay) {
      addOrReplaceRadar();
      timer = setInterval(addOrReplaceRadar, 120000);
    } else {
      removeLayer(radarLayerRef);
    }

    if (activeLayers.satelliteOverlay) {
      addOrReplaceSat();
    } else {
      removeLayer(satLayerRef);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [activeLayers.radarOverlay, activeLayers.satelliteOverlay]);

  const entities = useMemo(() => {
    const out = [];

    // ── AIRCRAFT ──────────────────────────────────────────────
    if (activeLayers.aircraft && Array.isArray(aircraft)) {
      for (const a of aircraft) {
        if (a?.latitude == null || a?.longitude == null) continue;
        const [lon, lat] = clamp(a.longitude, a.latitude);
        const altM = Math.max(0, Number(a.altitude || 0));
        const acColor = a.on_ground ? palette.aircraft.ground : palette.aircraft.air;
        const heading = Number(a.heading || 0);

        // Trail
        if (Array.isArray(a.trail) && a.trail.length > 1) {
          const pts = a.trail.map(p => Cartesian3.fromDegrees(
            ((p.lon + 180) % 360 + 360) % 360 - 180,
            Math.max(-85, Math.min(85, p.lat)), altM
          ));
          out.push(
            <Entity key={"ac-trail:" + a.id}
              polyline={{
                positions: pts, width: 1.5,
                material: new PolylineGlowMaterialProperty({
                  glowPower: 0.15,
                  color: Color.fromCssColorString(acColor).withAlpha(0.35),
                }),
                clampToGround: false,
              }}
            />
          );
        }

        // Billboard — SVG data URL, heading'e göre döner
        out.push(
          <Entity key={"ac:" + a.id}
            position={Cartesian3.fromDegrees(lon, lat, altM)}
            billboard={{
              image: aircraftDataUrl(acColor, heading),
              width: 32,
              height: 32,
              heightReference: a.on_ground ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
              verticalOrigin: VerticalOrigin.CENTER,
              scaleByDistance: { near: 5e4, nearValue: 2.0, far: 1e7, farValue: 0.5 },
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }}
            description={"<div style='font-family:monospace;font-size:12px;background:#0d1424;color:#e2e8f0;padding:10px;min-width:180px'>" +
              "<div style='color:#00d4ff;font-weight:bold'>✈️ " + (a.callsign || a.id || "") + "</div>" +
              "<div>🌍 " + (a.country || "Unknown") + "</div>" +
              "<div>ALT: " + Math.round(altM).toLocaleString() + " m  SPD: " + (a.speed || 0) + " km/h</div>" +
              "<div>HDG: " + heading + "°  SQUAWK: " + (a.squawk || "—") + "</div>" +
              "<div>📍 " + lat.toFixed(3) + "°, " + lon.toFixed(3) + "°</div>" +
              "</div>"}
          />
        );
      }
    }

    // ── SHIPS ─────────────────────────────────────────────────
    if (activeLayers.ships && Array.isArray(ships)) {
      for (const s of ships) {
        if (s?.latitude == null || s?.longitude == null) continue;
        const [lon, lat] = clamp(s.longitude, s.latitude);
        const shipColor = palette.ships;
        const heading = Number(s.heading || 0);

        // Trail
        if (Array.isArray(s.trail) && s.trail.length > 1) {
          const pts = s.trail.map(p => Cartesian3.fromDegrees(
            ((p.lon + 180) % 360 + 360) % 360 - 180,
            Math.max(-85, Math.min(85, p.lat)), 10
          ));
          out.push(
            <Entity key={"ship-trail:" + s.id}
              polyline={{
                positions: pts, width: 2,
                material: new PolylineGlowMaterialProperty({
                  glowPower: 0.2,
                  color: Color.fromCssColorString(shipColor).withAlpha(0.4),
                }),
                clampToGround: false,
              }}
            />
          );
        }

        // Billboard — SVG data URL
        out.push(
          <Entity key={"ship:" + s.id}
            position={Cartesian3.fromDegrees(lon, lat, 0)}
            billboard={{
              image: shipDataUrl(shipColor, heading),
              width: 28,
              height: 28,
              heightReference: HeightReference.CLAMP_TO_GROUND,
              verticalOrigin: VerticalOrigin.CENTER,
              scaleByDistance: { near: 5e4, nearValue: 2.5, far: 1e7, farValue: 0.6 },
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }}
            description={"<div style='font-family:monospace;font-size:12px;background:#0d1424;color:#e2e8f0;padding:10px;min-width:180px'>" +
              "<div style='color:#00ff88;font-weight:bold'>🚢 " + (s.name || s.mmsi || "Ship") + "</div>" +
              "<div>🏳️ " + (s.flag || s.country || "Unknown") + "  " + (s.ship_type || "") + "</div>" +
              "<div>SPD: " + (s.speed || 0) + " kn  HDG: " + heading + "°</div>" +
              "<div>📍 " + lat.toFixed(3) + "°, " + lon.toFixed(3) + "°</div>" +
              "</div>"}
          />
        );
      }
    }

    // ── SATELLITES ────────────────────────────────────────────
    if (activeLayers.satellites && Array.isArray(satellites)) {
      for (const sat of satellites) {
        if (sat?.latitude == null || sat?.longitude == null) continue;
        const [lon, lat] = clamp(sat.longitude, sat.latitude);
        const satColor = palette.satellites;
        const altKm = Number(sat.altitude || 400);
        const satAlt = Math.max(160_000, altKm * 1000);

        if (Array.isArray(sat.trail) && sat.trail.length > 1) {
          const pts = sat.trail.map(p => Cartesian3.fromDegrees(p.lon, p.lat, satAlt));
          out.push(
            <Entity key={"sat-trail:" + sat.id}
              polyline={{
                positions: pts, width: 1,
                material: new PolylineGlowMaterialProperty({
                  glowPower: 0.1,
                  color: Color.fromCssColorString(satColor).withAlpha(0.45),
                }),
              }}
            />
          );
        }

        out.push(
          <Entity key={"sat:" + sat.id}
            position={Cartesian3.fromDegrees(lon, lat, satAlt)}
            point={{
              pixelSize: 5,
              color: Color.fromCssColorString(satColor),
              outlineColor: Color.fromCssColorString("#0d1424"),
              outlineWidth: 1,
              heightReference: HeightReference.NONE,
            }}
            label={{
              text: sat.name || "Satellite",
              font: "10px monospace",
              fillColor: Color.fromCssColorString(satColor),
              outlineColor: Color.fromCssColorString("#0d1424"),
              outlineWidth: 2,
              verticalOrigin: VerticalOrigin.BOTTOM,
              pixelOffset: new Cartesian3(0, -10, 0),
              showBackground: true,
              backgroundColor: Color.fromCssColorString("#0d1424").withAlpha(0.7),
              distanceDisplayCondition: { near: 0, far: 3_000_000 },
            }}
            description={"<div style='font-family:monospace;font-size:12px;background:#0d1424;color:#e2e8f0;padding:10px'>" +
              "<div style='color:#a78bfa;font-weight:bold'>🛰️ " + (sat.name || "Satellite") + "</div>" +
              "<div>ALT: " + Math.round(altKm).toLocaleString() + " km</div>" +
              "<div>Period: " + (sat.period_min || 0).toFixed(1) + " min</div>" +
              "</div>"}
          />
        );
      }
    }

    // ── EARTHQUAKES ───────────────────────────────────────────
    if (activeLayers.persons && Array.isArray(persons)) {
      for (const p of persons) {
        if (p?.latitude == null || p?.longitude == null) continue;
        const [lon, lat] = clamp(Number(p.longitude), Number(p.latitude));
        const risk = String(p.risk_level || "low").toLowerCase();
        const isSelected = selectedPersonId === p.id;
        const color = risk === "critical" ? "#ff3366" : risk === "high" ? "#ff6633" : risk === "medium" ? "#ffaa00" : "#22d3ee";
        out.push(
          <Entity key={`prs:${p.id}`}
            position={Cartesian3.fromDegrees(lon, lat, 0)}
            point={{
              pixelSize: isSelected ? 12 : 8,
              color: Color.fromCssColorString(color).withAlpha(isSelected ? 0.8 : 0.45),
              outlineColor: Color.fromCssColorString(color),
              outlineWidth: isSelected ? 3 : 2,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            }}
            description={"<div style='font-family:monospace;font-size:12px;background:#0d1424;color:#e2e8f0;padding:10px;min-width:220px'>" +
              "<div style='color:#22d3ee;font-weight:bold'>👤 " + (p.full_name || p.id || "Person") + "</div>" +
              "<div>Role: " + (p.role || "unknown") + " · Status: " + (p.status || "unknown") + "</div>" +
              "<div>Risk: " + String(p.risk_level || "low").toUpperCase() + " · " + (p.city || "Unknown") + ", " + (p.country || "") + "</div>" +
              "<div>" + (p.email || "") + "</div>" +
              "</div>"}
          />
        );
      }
    }

    // ── EARTHQUAKES ───────────────────────────────────────────
    if (activeLayers.earthquakes && Array.isArray(earthquakes)) {
      for (const eq of earthquakes) {
        if (eq?.latitude == null || eq?.longitude == null) continue;
        const [lon, lat] = clamp(eq.longitude, eq.latitude);
        const mag = Number(eq.magnitude || 0);
        const color = palette.eq(mag);
        out.push(
          <Entity key={"eq:" + eq.id}
            position={Cartesian3.fromDegrees(lon, lat, 0)}
            point={{
              pixelSize: Math.max(6, Math.min(18, Math.round(mag * 3))),
              color: Color.fromCssColorString(color).withAlpha(0.7),
              outlineColor: Color.fromCssColorString("#0d1424"),
              outlineWidth: 1,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            }}
            description={"<div style='font-family:monospace;font-size:12px;background:#0d1424;color:#e2e8f0;padding:10px'>" +
              "<div style='color:" + color + ";font-weight:bold'>🌍 M" + mag.toFixed(1) + "</div>" +
              "<div>" + (eq.place || "") + "</div>" +
              "<div>Depth: " + Number(eq.depth_km || 0).toFixed(1) + " km</div>" +
              "</div>"}
          />
        );
      }
    }

    // ── WEATHER ALERTS ────────────────────────────────────────
    if (activeLayers.weatherAlerts && Array.isArray(weatherAlerts)) {
      for (const w of weatherAlerts) {
        if (w?.latitude == null || w?.longitude == null) continue;
        const [lon, lat] = clamp(w.longitude, w.latitude);
        const sev = (w.severity || "unknown").toLowerCase();
        const color = palette.weather(sev);
        out.push(
          <Entity key={"wx:" + (w.id || lon + lat)}
            position={Cartesian3.fromDegrees(lon, lat, 0)}
            point={{
              pixelSize: 8,
              color: Color.fromCssColorString(color).withAlpha(0.35),
              outlineColor: Color.fromCssColorString(color),
              outlineWidth: 2,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            }}
            description={"<div style='font-family:monospace;font-size:12px;background:#0d1424;color:#e2e8f0;padding:10px'>" +
              "<div style='color:" + color + ";font-weight:bold'>🌪️ " + (w.event || "Weather Alert") + "</div>" +
              "<div>" + (w.severity || "") + " · " + (w.area || "").slice(0, 80) + "</div>" +
              "</div>"}
          />
        );
      }
    }

    // ── NEWS ──────────────────────────────────────────────────
    if (activeLayers.news && Array.isArray(news)) {
      for (const n of news) {
        if (n?.latitude == null || n?.longitude == null) continue;
        const [lon, lat] = clamp(n.longitude, n.latitude);
        const color = palette.news;
        out.push(
          <Entity key={"news:" + n.id}
            position={Cartesian3.fromDegrees(lon, lat, 0)}
            point={{
              pixelSize: 7,
              color: Color.fromCssColorString(color).withAlpha(0.25),
              outlineColor: Color.fromCssColorString(color),
              outlineWidth: 1,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            }}
            description={"<div style='font-family:monospace;font-size:12px;background:#0d1424;color:#e2e8f0;padding:10px;min-width:220px'>" +
              "<div style='color:#00d4ff;font-weight:bold'>📰 " + (n.title || "News").slice(0, 80) + "</div>" +
              "<div>" + (n.source || "") + (n.country ? " · " + n.country.toUpperCase() : "") + "</div>" +
              "</div>"}
          />
        );
      }
    }

    // ── CYBER THREATS ─────────────────────────────────────────
    if (activeLayers.threats && Array.isArray(threats)) {
      for (const t of threats) {
        if (t?.latitude == null || t?.longitude == null) continue;
        const [lon, lat] = clamp(t.longitude, t.latitude);
        const color = palette.threats;
        out.push(
          <Entity key={"th:" + t.id}
            position={Cartesian3.fromDegrees(lon, lat, 0)}
            point={{
              pixelSize: 9,
              color: Color.fromCssColorString(color).withAlpha(0.35),
              outlineColor: Color.fromCssColorString(color),
              outlineWidth: 2,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            }}
            description={"<div style='font-family:monospace;font-size:12px;background:#0d1424;color:#e2e8f0;padding:10px'>" +
              "<div style='color:#ff3366;font-weight:bold'>🔴 Cyber Threat</div>" +
              "<div>" + (t.ip || "") + " · " + (t.malware || "") + "</div>" +
              "<div>" + (t.country || "") + "</div>" +
              "</div>"}
          />
        );
      }
    }

    // ── GPS JAMMING ───────────────────────────────────────────
    if (activeLayers.gpsJamming && Array.isArray(gpsJamming)) {
      for (const j of gpsJamming) {
        if (j?.latitude == null || j?.longitude == null) continue;
        const [lon, lat] = clamp(j.longitude, j.latitude);
        const sev = j.severity || "medium";
        const color = sev === "critical" ? "#ff0000" : sev === "high" ? "#ff4400" : sev === "medium" ? "#ff8800" : "#ffaa44";
        const radiusKm = j.radius_km || 150;
        out.push(
          <Entity key={"jam:" + j.id}
            position={Cartesian3.fromDegrees(lon, lat, 0)}
            ellipse={{
              semiMajorAxis: radiusKm * 1000,
              semiMinorAxis: radiusKm * 1000,
              material: Color.fromCssColorString(color).withAlpha(0.18),
              outline: true,
              outlineColor: Color.fromCssColorString(color).withAlpha(0.7),
              outlineWidth: 2,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            }}
            description={"<div style='font-family:monospace;font-size:12px;background:#0d1424;color:#e2e8f0;padding:10px'>" +
              "<div style='color:" + color + ";font-weight:bold'>📡 GPS JAMMING</div>" +
              "<div>" + (j.region || "Unknown") + "</div>" +
              "<div>Severity: " + sev.toUpperCase() + " · R: " + radiusKm + "km</div>" +
              "</div>"}
          />
        );
      }
    }

    // ── WILDFIRES ─────────────────────────────────────────────
    if (activeLayers.wildfires && Array.isArray(wildfires)) {
      for (const w of wildfires.slice(0, 800)) {
        if (w?.latitude == null || w?.longitude == null) continue;
        const [lon, lat] = clamp(Number(w.longitude), Number(w.latitude));
        const color = palette.wildfires || "#ff6b35";
        out.push(
          <Entity
            key={"wf:" + (w.id || `${lat},${lon}`)}
            position={Cartesian3.fromDegrees(lon, lat, 0)}
            point={{
              pixelSize: 9,
              color: Color.fromCssColorString(color).withAlpha(0.35),
              outlineColor: Color.fromCssColorString(color),
              outlineWidth: 2,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            }}
            description={
              "<div style='font-family:monospace;font-size:12px;background:#0d1424;color:#e2e8f0;padding:10px;min-width:240px'>" +
              "<div style='color:" + color + ";font-weight:bold'>🔥 " + (w.title || "Wildfire").slice(0, 120) + "</div>" +
              "<div>Source: " + (w.source || "eonet") + "</div>" +
              (w.reported_at ? "<div>Reported: " + String(w.reported_at).slice(0, 19) + "</div>" : "") +
              (w.geo_precision ? "<div>Geo: " + String(w.geo_precision) + "</div>" : "") +
              (w.url ? "<div style='margin-top:6px'><a href='" + w.url + "' target='_blank' rel='noreferrer' style='color:#a78bfa;text-decoration:underline'>open source</a></div>" : "") +
              "</div>"
            }
          />
        );
      }
    }

    // ── CAMERAS ───────────────────────────────────────────────
    if (activeLayers.cameras && Array.isArray(cameras)) {
      for (const c of cameras.slice(0, 900)) {
        if (c?.latitude == null || c?.longitude == null) continue;
        const [lon, lat] = clamp(Number(c.longitude), Number(c.latitude));
        const color = palette.satellites || "#a78bfa";
        const name = (c.name || "Camera").slice(0, 90);
        const provider = (c.provider || c.source || "osint").toString();
        const stream = c.stream_url || c.url || "";
        const osm = c.osm_url || "";
        out.push(
          <Entity
            key={"cam:" + (c.id || `${lat},${lon}`)}
            position={Cartesian3.fromDegrees(lon, lat, 0)}
            point={{
              pixelSize: 7,
              color: Color.fromCssColorString(color).withAlpha(0.25),
              outlineColor: Color.fromCssColorString(color),
              outlineWidth: 1,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            }}
            description={
              "<div style='font-family:monospace;font-size:12px;background:#0d1424;color:#e2e8f0;padding:10px;min-width:260px'>" +
              "<div style='color:" + color + ";font-weight:bold'>📷 " + name + "</div>" +
              "<div>Provider: " + provider + "</div>" +
              (stream ? "<div style='margin-top:6px'><a href='" + stream + "' target='_blank' rel='noreferrer' style='color:#00d4ff;text-decoration:underline'>open stream</a></div>" : "") +
              (osm ? "<div style='margin-top:6px'><a href='" + osm + "' target='_blank' rel='noreferrer' style='color:#a78bfa;text-decoration:underline'>open OSM</a></div>" : "") +
              "</div>"
            }
          />
        );
      }
    }

    // ── CONFLICT EVENTS ───────────────────────────────────────
    if (activeLayers.conflicts && Array.isArray(conflicts)) {
      for (const c of conflicts.slice(0, 600)) {
        if (c?.latitude == null || c?.longitude == null) continue;
        const [lon, lat] = clamp(Number(c.longitude), Number(c.latitude));
        const color = palette.threats || "#ff3366";
        out.push(
          <Entity
            key={"cf:" + (c.id || `${lat},${lon}`)}
            position={Cartesian3.fromDegrees(lon, lat, 0)}
            point={{
              pixelSize: 8,
              color: Color.fromCssColorString(color).withAlpha(0.38),
              outlineColor: Color.fromCssColorString(color),
              outlineWidth: 2,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            }}
            description={
              "<div style='font-family:monospace;font-size:12px;background:#0d1424;color:#e2e8f0;padding:10px;min-width:240px'>" +
              "<div style='color:#ff3366;font-weight:bold'>⚠ " + (c.title || "Conflict Event").slice(0, 120) + "</div>" +
              "<div>Source: " + (c.source || "-") + "</div>" +
              (c.country ? "<div>Country: " + c.country + "</div>" : "") +
              (c.mention_count != null ? "<div>Mentions: " + c.mention_count + "</div>" : "") +
              (c.url ? "<div style='margin-top:6px'><a href='" + c.url + "' target='_blank' rel='noreferrer' style='color:#a78bfa;text-decoration:underline'>open source</a></div>" : "") +
              "</div>"
            }
          />
        );
      }
    }

    // ── CYBER IOCS ────────────────────────────────────────────
    if (activeLayers.cyberIocs && Array.isArray(cyberIocs)) {
      for (const ioc of cyberIocs.slice(0, 700)) {
        if (ioc?.latitude == null || ioc?.longitude == null) continue;
        const [lon, lat] = clamp(Number(ioc.longitude), Number(ioc.latitude));
        const color = "#f43f5e";
        out.push(
          <Entity
            key={"ioc:" + (ioc.id || `${lat},${lon}`)}
            position={Cartesian3.fromDegrees(lon, lat, 0)}
            point={{
              pixelSize: 6,
              color: Color.fromCssColorString(color).withAlpha(0.35),
              outlineColor: Color.fromCssColorString(color),
              outlineWidth: 1.5,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            }}
            description={
              "<div style='font-family:monospace;font-size:12px;background:#0d1424;color:#e2e8f0;padding:10px;min-width:240px'>" +
              "<div style='color:#f43f5e;font-weight:bold'>🧪 IOC " + (ioc.host || "").slice(0, 90) + "</div>" +
              "<div>Payload: " + (ioc.payload || "-") + "</div>" +
              (ioc.tags ? "<div>Tags: " + ioc.tags + "</div>" : "") +
              (ioc.url ? "<div style='margin-top:6px'><a href='" + ioc.url + "' target='_blank' rel='noreferrer' style='color:#a78bfa;text-decoration:underline'>open source</a></div>" : "") +
              "</div>"
            }
          />
        );
      }
    }

    // ── ROUTE OPS OVERLAY ─────────────────────────────────────
    if (activeLayers.routeOps && routeOpsOverlay?.routes?.length) {
      const selectedId = routeOpsOverlay.selected_route_id || routeOpsOverlay.recommended_route_id;
      const r = routeOpsOverlay.routes.find((x) => x.id === selectedId) || routeOpsOverlay.routes[0];
      const pts = (r?.route || []).map((p) => Cartesian3.fromDegrees(p.lon, p.lat, 2000));
      if (pts.length > 1) {
        out.push(
          <Entity
            key={"routeops-main"}
            polyline={{
              positions: pts,
              width: 4,
              material: new PolylineGlowMaterialProperty({
                glowPower: 0.2,
                color: Color.fromCssColorString("#00d4ff").withAlpha(0.85),
              }),
              clampToGround: false,
            }}
          />
        );
      }
      for (const inc of (r?.incidents || []).slice(0, 120)) {
        if (inc.lat == null || inc.lon == null) continue;
        const c = inc.severity === "critical" ? "#ff3366" : inc.severity === "high" ? "#ff6633" : inc.severity === "medium" ? "#ffaa00" : "#38bdf8";
        out.push(
          <Entity
            key={`routeops-inc-${inc.kind}-${inc.route_index}-${inc.lat}-${inc.lon}`}
            position={Cartesian3.fromDegrees(inc.lon, inc.lat, 0)}
            point={{
              pixelSize: Math.max(5, Math.min(10, Math.round(inc.impact || 5))),
              color: Color.fromCssColorString(c).withAlpha(0.45),
              outlineColor: Color.fromCssColorString(c),
              outlineWidth: 2,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            }}
            description={`<div style='font-family:monospace;font-size:12px;background:#0d1424;color:#e2e8f0;padding:10px'><div style='color:${c};font-weight:bold'>RouteOps Incident</div><div>${inc.title || ""}</div><div>${inc.kind || ""} · ${inc.distance_km || 0}km</div></div>`}
          />
        );
      }
    }

    return out;
  }, [activeLayers, aircraft, ships, satellites, persons, earthquakes, weatherAlerts, news, threats, wildfires, cameras, conflicts, cyberIocs, gpsJamming, routeOpsOverlay, palette, selectedPersonId]);

  // GSD hesabı (kamera yüksekliğinden)
  const gsd = (cameraHeight * 0.000372).toFixed(2);
  const niirs = cameraHeight < 5000 ? "4.2" : cameraHeight < 50000 ? "2.9" : cameraHeight < 500000 ? "1.4" : "0.0";
  const altKmDisplay = cameraHeight >= 1000 ? Math.round(cameraHeight).toLocaleString() + "M" : Math.round(cameraHeight) + "M";
  // Panoptic metrikler — aircraft sayısından hesap
  const visCount = aircraft.length;
  const srcCount = satellites.length + ships.length;
  const dens = srcCount > 0 ? (visCount / Math.max(srcCount, 1) * 0.46).toFixed(2) : "0.00";

  // Tema rengi
  const themeColor =
    mapTheme === "nvg"  ? "#39ff14" :
    mapTheme === "flir" ? "#ff6600" :
    mapTheme === "crt"  ? "#00ff88" :
    mapTheme === "noir" ? "#ffffff" : "#00d4ff";

  return (
    <div className="w-full h-full relative">
      <Viewer ref={viewerRef} full
        animation={false} timeline={false} baseLayerPicker={false}
        geocoder={false} homeButton={false} sceneModePicker={false}
        navigationHelpButton={false} infoBox={true} selectionIndicator={true}
        shouldAnimate={false} requestRenderMode={true} maximumRenderTimeChange={1 / 10}>
        {entities}
      </Viewer>

      {/* Tema efekt overlay'leri */}
      {mapTheme === "nvg" && <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at center,transparent 60%,rgba(0,80,0,0.3) 100%)", mixBlendMode: "multiply" }} />}
      {mapTheme === "flir" && <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at center,transparent 60%,rgba(255,60,0,0.15) 100%)" }} />}

      {/* ── Sol üst: PANOPTIC metrik bar ── */}
      <div className="absolute top-2 left-2 z-[1000] pointer-events-none">
        <div className="font-mono text-[10px] tracking-wider px-2 py-1 rounded" style={{ color: themeColor, background: "rgba(10,14,26,0.75)" }}>
          PANOPTIC&nbsp; VIS:{visCount}&nbsp; SRC:{srcCount}&nbsp; DENS:{dens}&nbsp; 0.4ms
        </div>
      </div>

      {/* ── Sağ üst: ACTIVE STYLE ── */}
      {mapTheme !== "normal" && (
        <div className="absolute top-2 right-2 z-[1000] pointer-events-none text-right">
          <div className="text-[9px] tracking-widest font-mono" style={{ color: themeColor, opacity: 0.6 }}>ACTIVE STYLE</div>
          <div className="text-[13px] font-bold tracking-[0.2em] font-mono" style={{ color: themeColor }}>
            {mapTheme === "nvg" ? "NIGHT VISION" : mapTheme.toUpperCase()}
          </div>
        </div>
      )}

      {/* ── Sol alt: Mouse koordinatları DMS ── */}
      {mouseCoords && (
        <div className="absolute bottom-2 left-2 z-[1000] pointer-events-none">
          <div className="font-mono text-[10px] tracking-wider px-2 py-0.5 rounded" style={{ color: themeColor, background: "rgba(10,14,26,0.75)" }}>
            {toDMS(mouseCoords.lat, "N", "S")}&nbsp;&nbsp;{toDMS(mouseCoords.lon, "E", "W")}
          </div>
        </div>
      )}

      {/* ── Sağ alt: GSD / NIIRS / ALT / SUN ── */}
      <div className="absolute bottom-2 right-2 z-[1000] pointer-events-none text-right">
        <div className="font-mono text-[10px] tracking-wider px-2 py-1 rounded" style={{ color: themeColor, background: "rgba(10,14,26,0.75)" }}>
          <div>GSD: {gsd}M&nbsp; NIIRS: {niirs}</div>
          <div>ALT: {altKmDisplay}&nbsp; SUN: -33.1° EL</div>
        </div>
      </div>

      {/* ── Globe üstü entity sayaçları (mevcut) ── */}
      <div className="absolute top-8 left-2 z-[1000] flex gap-2 pointer-events-none flex-wrap mt-1">
        {activeLayers.aircraft && (
          <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#00d4ff]">✈️ {aircraft.length.toLocaleString()}</div>
        )}
        {activeLayers.ships && ships.length > 0 && <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#00ff88]">🚢 {ships.length}</div>}
        {activeLayers.satellites && <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#a78bfa]">🛰️ {satellites.length}</div>}
        {activeLayers.persons && persons.length > 0 && <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#22d3ee]">👤 {persons.length}</div>}
        {activeLayers.earthquakes && (
          <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#ffaa00]">🌍 {earthquakes.length}</div>
        )}
        {activeLayers.threats && (
          <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#ff3366]">🔴 {threats.length}</div>
        )}
        {activeLayers.conflicts && conflicts.length > 0 && (
          <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#ff3366]">⚠ {conflicts.length}</div>
        )}
        {activeLayers.cyberIocs && cyberIocs.length > 0 && (
          <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#f43f5e]">🧪 {cyberIocs.length}</div>
        )}
        {activeLayers.gpsJamming && gpsJamming.length > 0 && <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#ff8800]">📡 {gpsJamming.length}</div>}
        {activeLayers.routeOps && routeOpsOverlay?.routes?.length > 0 && (
          <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#00d4ff]">🧭 ROUTE {routeOpsOverlay.selected_route_id || routeOpsOverlay.recommended_route_id}</div>
        )}
      </div>

      {/* ── Gelişmiş tıklama detay paneli ── */}
      {selectedDetail && (
        <div className="absolute right-2 top-16 z-[1100] w-[320px] bg-[#0d1424]/95 border border-[#1a2744] rounded-lg shadow-2xl">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a2744]">
            <div>
              <div className="text-[10px] tracking-widest text-slate-500">{selectedDetail.subtitle}</div>
              <div className="text-sm text-slate-100 font-semibold">{selectedDetail.title}</div>
            </div>
            <button
              onClick={() => setSelectedDetail(null)}
              className="text-slate-500 hover:text-white text-xs px-1"
              title="Close"
            >
              X
            </button>
          </div>
          <div className="p-3 space-y-1">
            {selectedDetail.lines.map((line, idx) => (
              <div key={idx} className="text-[11px] text-slate-300 font-mono leading-snug break-all">{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}