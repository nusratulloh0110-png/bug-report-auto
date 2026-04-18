class LauncherStore {
  constructor() {
    this.launchers = new Map();
  }

  get(channelId) {
    return this.launchers.get(channelId) || null;
  }

  set(channelId, value) {
    this.launchers.set(channelId, value);
    return value;
  }
}

export const launcherStore = new LauncherStore();
