import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The Raisory app icon (docs/design/brand/logo/app-icon.svg), square and full bleed. */
export default function AppleIcon() {
  return new ImageResponse(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width="180"
      height="180"
    >
      <rect width="48" height="48" fill="#0E1C3B" />
      <g transform="translate(6 6) scale(0.75)">
        <path
          d="M33.83 24.14A12 12 0 1 1 23.86 14.17"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <circle cx="35.77" cy="12.23" r="5.75" fill="#FF7A30" />
      </g>
    </svg>,
    size,
  );
}
