import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        empire: {
          gold: "#c9a84c",
          stone: "#8a8578",
          dark: "#1a1a2e",
          parchment: "#f0e6d3",
        },
      },
    },
  },
  plugins: [],
};
export default config;
