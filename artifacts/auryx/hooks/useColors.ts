import colors from "@/constants/colors";

/**
 * Returns the design tokens for the current color scheme.
 * Auryx is always dark-theme; colors.dark is the single palette.
 */
export function useColors() {
  return { ...colors.dark, radius: colors.radius };
}
