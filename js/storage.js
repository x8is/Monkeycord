// Local persistence (settings, personal bests, history). Browser storage can
// be unavailable (private mode, blocked site data), so every access is guarded
// and the app works fine without it.
const KEY = 'monkeycord.v1';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

let data = { settings: {}, pbs: {}, history: [], ...read() };

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

export const store = {
  get settings() {
    return data.settings;
  },
  saveSettings(patch) {
    data.settings = { ...data.settings, ...patch };
    write();
  },
  /** Record a result; returns {isPb, previous}. higherIsBetter for cpm/npm. */
  submit(key, value, { higherIsBetter = true, details = {} } = {}) {
    const previous = data.pbs[key];
    const isPb =
      previous == null || (higherIsBetter ? value > previous.value : value < previous.value);
    if (isPb) data.pbs[key] = { value, at: Date.now() };
    data.history.unshift({ key, value, at: Date.now(), ...details });
    data.history = data.history.slice(0, 300);
    write();
    return { isPb, previous: previous?.value ?? null };
  },
  pb(key) {
    return data.pbs[key]?.value ?? null;
  },
  history(prefix = '') {
    return data.history.filter((h) => h.key.startsWith(prefix));
  },
};
