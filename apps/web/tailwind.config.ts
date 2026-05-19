import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#ffffff",
          warm: "#eaf5fb",
          deep: "#005b86",
        },
        bg: {
          DEFAULT: "#f5f9fc",
          deep: "#e8f3f8",
        },
        fg: {
          DEFAULT: "#143141",
          muted: "#4d6674",
          soft: "#7690a0",
          "on-dark": "#ffffff",
        },
        accent: {
          DEFAULT: "#00618f",
          flame: "#008fc4",
          block: "#0aa2cf",
        },
        sunshine: {
          900: "#00749f",
          700: "#0098c8",
          500: "#4bb9d6",
          300: "#9dd8e8",
        },
        gold: "#cfeaf4",
        yellow: "#e6f6fb",
        border: {
          DEFAULT: "#d5e6ee",
          strong: "#a9c9d8",
        },
        hairline: "#e4edf2",
        danger: "#c0331a",
        warn: "#d97706",
        ok: "#2f7d4f",
      },
      fontFamily: {
        display: [
          "Arial",
          "Helvetica Neue",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        body: [
          "Arial",
          "Helvetica Neue",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "IBM Plex Mono",
          "Menlo",
          "monospace",
        ],
      },
      boxShadow: {
        card:
          "rgba(0,91,134,0.10) -2px 4px 12px, rgba(0,91,134,0.06) -8px 16px 28px, rgba(0,91,134,0.04) -20px 40px 56px",
        pop:
          "rgba(0,91,134,0.14) -8px 16px 39px, rgba(0,91,134,0.10) -33px 64px 72px, rgba(0,91,134,0.06) -73px 144px 97px",
      },
      letterSpacing: {
        tightest: "-2.4px",
      },
      borderRadius: {
        none: "0px",
      },
    },
  },
};

export default config;
