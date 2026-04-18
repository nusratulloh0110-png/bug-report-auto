class BugStore {
  constructor() {
    this.sequence = 1;
    this.bugs = new Map();
  }

  generateId() {
    const number = String(this.sequence).padStart(4, "0");
    this.sequence += 1;
    return `BUG-${number}`;
  }

  syncSequence(nextSequence) {
    if (Number.isInteger(nextSequence) && nextSequence > this.sequence) {
      this.sequence = nextSequence;
    }
  }

  create(payload) {
    const bugId = this.generateId();
    const bug = {
      bugId,
      status: "new",
      jiraKey: null,
      jiraUrl: null,
      duplicateOf: null,
      rejectionReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...payload,
    };

    this.bugs.set(bugId, bug);
    return bug;
  }

  get(bugId) {
    return this.bugs.get(bugId) || null;
  }

  update(bugId, patch) {
    const current = this.get(bugId);
    if (!current) {
      return null;
    }

    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    this.bugs.set(bugId, next);
    return next;
  }
}

export const bugStore = new BugStore();
