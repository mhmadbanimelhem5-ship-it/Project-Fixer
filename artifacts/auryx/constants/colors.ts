const colors = {
  dark: {
    background: "#0A0F1E",
    backgroundSecondary: "#0D1428",
    backgroundTertiary: "#111827",

    text: "#FFFFFF",
    textSecondary: "#A0AEC0",
    textMuted: "#4A5568",

    gold: "#D4AF37",
    goldLight: "#F0CE60",
    goldDark: "#B8960C",

    purple: "#8B5CF6",
    purpleLight: "#A78BFA",
    purpleDark: "#6D28D9",

    blue: "#3B82F6",
    blueLight: "#60A5FA",
    blueDark: "#1D4ED8",

    red: "#EF4444",
    redLight: "#F87171",
    redDark: "#B91C1C",

    teal: "#14B8A6",
    green: "#22C55E",
    orange: "#F97316",

    glass: "rgba(255,255,255,0.05)",
    glassBorder: "rgba(255,255,255,0.10)",
    glassMedium: "rgba(255,255,255,0.08)",

    goldGlass: "rgba(212,175,55,0.10)",
    purpleGlass: "rgba(139,92,246,0.10)",
    blueGlass: "rgba(59,130,246,0.10)",
    redGlass: "rgba(239,68,68,0.10)",

    border: "rgba(255,255,255,0.08)",
    separator: "rgba(255,255,255,0.05)",

    card: "#111827",
    cardSecondary: "#1A2236",

    primary: "#D4AF37",
    primaryForeground: "#0A0F1E",
    secondary: "#8B5CF6",
    secondaryForeground: "#FFFFFF",

    tint: "#D4AF37",
    foreground: "#FFFFFF",
    muted: "#1A2236",
    mutedForeground: "#6B7280",
    accent: "#8B5CF6",
    accentForeground: "#FFFFFF",
    destructive: "#EF4444",
    destructiveForeground: "#FFFFFF",
    input: "rgba(255,255,255,0.08)",
  },

  light: {
    background: "#F4F6FB",
    backgroundSecondary: "#EAF0F8",
    backgroundTertiary: "#DDE5F0",

    text: "#0A0F1E",
    textSecondary: "#4A5568",
    textMuted: "#9CA3AF",

    gold: "#B8960C",
    goldLight: "#D4AF37",
    goldDark: "#8B6E00",

    purple: "#7C3AED",
    purpleLight: "#8B5CF6",
    purpleDark: "#6D28D9",

    blue: "#2563EB",
    blueLight: "#3B82F6",
    blueDark: "#1D4ED8",

    red: "#DC2626",
    redLight: "#EF4444",
    redDark: "#B91C1C",

    teal: "#0D9488",
    green: "#16A34A",
    orange: "#EA580C",

    glass: "rgba(0,0,0,0.04)",
    glassBorder: "rgba(0,0,0,0.09)",
    glassMedium: "rgba(0,0,0,0.06)",

    goldGlass: "rgba(184,150,12,0.10)",
    purpleGlass: "rgba(124,58,237,0.10)",
    blueGlass: "rgba(37,99,235,0.10)",
    redGlass: "rgba(220,38,38,0.10)",

    border: "rgba(0,0,0,0.09)",
    separator: "rgba(0,0,0,0.05)",

    card: "#FFFFFF",
    cardSecondary: "#F4F6FB",

    primary: "#B8960C",
    primaryForeground: "#FFFFFF",
    secondary: "#7C3AED",
    secondaryForeground: "#FFFFFF",

    tint: "#B8960C",
    foreground: "#0A0F1E",
    muted: "#EAF0F8",
    mutedForeground: "#6B7280",
    accent: "#7C3AED",
    accentForeground: "#FFFFFF",
    destructive: "#DC2626",
    destructiveForeground: "#FFFFFF",
    input: "rgba(0,0,0,0.06)",
  },

  radius: 16,
};

export default colors;
export type ThemeColors = typeof colors.dark;
