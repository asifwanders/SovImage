import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "src");

const config = {
  plugins: {
    "@tailwindcss/postcss": { base: sourceRoot },
  },
};

export default config;
