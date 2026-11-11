import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0f14",
        panel: "#131a22",
        panel2: "#1a232e",
        line: "#243040",
        txt: "#e6edf3",
        mut: "#8b9bb0",
        pos: "#2ecc71",
        neg: "#ff5a5a",
        brand: "#4c8bf5",
      },
    },
  },
  plugins: [],
};
export default config;
