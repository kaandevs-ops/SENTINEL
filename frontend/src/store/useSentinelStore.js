import { create } from "zustand";

export const useSentinelStore = create((set, get) => ({
  // Live data
  aircraft: [],
  gpsJamming: [],
  ships: [],
  satellites: [],
  persons: [],
  earthquakes: [],
  weatherAlerts: [],
  news: [],
  threats: [],
  wildfires: [],
  cameras: [],
  conflicts: [],
  cyberIocs: [],
  alerts: [],

  // UI state
  activeLayers: {
    aircraft: false,
    gpsJamming: false,
    ships: false,
    satellites: false,
    persons: false,
    earthquakes: false,
    weatherAlerts: false,
    radarOverlay: false,
    satelliteOverlay: false,
    news: false,
    threats: false,
    wildfires: false,
    cameras: false,
    conflicts: false,
    cyberIocs: false,
    routeOps: false,
  },
  selectedEntity: null,
  selectedPersonId: null,
  wsStatus: "disconnected",
  feedHealth: {
    aircraft: {
      status: "unknown", // healthy | degraded | stale | unknown
      lastFetch: null,
      lastError: null,
      updatedAt: null,
    },
    ships: { status: "unknown", lastFetch: null, lastError: null, updatedAt: null },
    satellites: { status: "unknown", lastFetch: null, lastError: null, updatedAt: null },
    earthquakes: { status: "unknown", lastFetch: null, lastError: null, updatedAt: null },
    weather: { status: "unknown", lastFetch: null, lastError: null, updatedAt: null },
    news: { status: "unknown", lastFetch: null, lastError: null, updatedAt: null },
    threats: { status: "unknown", lastFetch: null, lastError: null, updatedAt: null },
    wildfires: { status: "unknown", lastFetch: null, lastError: null, updatedAt: null },
    cameras: { status: "unknown", lastFetch: null, lastError: null, updatedAt: null },
    conflicts: { status: "unknown", lastFetch: null, lastError: null, updatedAt: null },
    cyber_iocs: { status: "unknown", lastFetch: null, lastError: null, updatedAt: null },
  },
  feedTimeline: [],

  // Map theme
  mapTheme: "normal",
  setMapTheme: (theme) => set({ mapTheme: theme }),
  routeOpsOverlay: null,
  setRouteOpsOverlay: (overlay) => set({ routeOpsOverlay: overlay }),
  clearRouteOpsOverlay: () => set({ routeOpsOverlay: null }),

  // Stats
  stats: { aircraft: 0, ships: 0, satellites: 0, earthquakes: 0, threats: 0 },

  // Actions
  setLiveData: (type, data) => set({ [type]: data }),

  toggleLayer: (layer) =>
    set((s) => ({
      activeLayers: { ...s.activeLayers, [layer]: !s.activeLayers[layer] },
    })),

  addAlert: (alert) =>
    set((s) => ({ alerts: [alert, ...s.alerts].slice(0, 100) })),

  setSelectedEntity: (entity) => set({ selectedEntity: entity }),
  setSelectedPersonId: (personId) => set({ selectedPersonId: personId }),
  setWsStatus: (status) => set({ wsStatus: status }),
  setFeedHealth: (feed, patch) =>
    set((s) => ({
      feedHealth: {
        ...s.feedHealth,
        [feed]: { ...(s.feedHealth[feed] || {}), ...patch },
      },
    })),
  setFeedTimeline: (events) =>
    set(() => ({
      feedTimeline: (Array.isArray(events) ? events : []).slice(0, 50),
    })),
  addFeedTimelineEvent: (event) =>
    set((s) => {
      if (!event || !event.id) return {};
      if (s.feedTimeline.some((e) => e.id === event.id)) return {};
      return { feedTimeline: [event, ...s.feedTimeline].slice(0, 50) };
    }),
  setPlaybackData: (data) =>
    set((s) => ({
      aircraft: data ? data.aircraft : s.aircraft,
      ships: data ? data.ships : s.ships,
    })),
  updateStats: () => {
    const s = get();
    set({
      stats: {
        aircraft: s.aircraft.length,
        ships: s.ships.length,
        satellites: s.satellites.length,
        earthquakes: s.earthquakes.length,
        threats: s.threats.length,
      },
    });
  },
}));
