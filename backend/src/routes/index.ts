// routes/index.ts — barrel re-export of singleton Service instances.
// Used by demoData.ts to keep the cache in sync with the actual route handlers.
//
// DO NOT add route registrations here (those live in server.ts).
// This file exists only to break the circular import between demoData.ts
// and the individual route files.

export { subjectsServiceInstance } from "./subjects.js";
export { eventsServiceInstance } from "./events.js";
export { notesServiceInstance } from "./notes.js";
export { tasksServiceInstance } from "./tasks.js";
