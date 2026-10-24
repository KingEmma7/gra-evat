import { config } from 'zod';

// Keep this side-effect import before SDK/schema imports in the client entry.
// Zod probes optional code generation while constructing objects, before parsing.
// Only the playground's browser realm opts out; server SDK defaults stay unchanged.
if (typeof window !== 'undefined') config({ jitless: true });
