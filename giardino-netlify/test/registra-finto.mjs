// node --import ./test/registra-finto.mjs …  →  "@netlify/blobs" diventa l'archivio in memoria dei test
import { register } from "node:module";
register(new URL("./risolvi.mjs", import.meta.url));
