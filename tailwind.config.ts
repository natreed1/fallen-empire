import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'cinzel': ['var(--font-cinzel-decorative)', 'serif'],
        'medieval': ['var(--font-medieval)', 'cursive'],
      },
      colors: {
        empire: {
          gold: "#c9a84c",
          stone: "#8a8578",
          dark: "#1a1a2e",
          parchment: "#f0e6d3",
        },
        cottage: {
          wood: "#3d2e22",
          plank: "#5c4332",
          brass: "#a07848",
          glow: "#d4b896",
        },
        maproom: {
          ink: "#2c4a52",
          sea: "#4a8a7a",
          parchment: "#d4c4a8",
          grid: "rgba(74, 120, 110, 0.35)",
        },
      },
    },
  },
  plugins: [],
};
export default config;
