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
      <rect width="48" height="48" fill="#0E2B21" />
      <g transform="translate(6 6) scale(0.75)">
        <path
          d="M35.1 22.65A13 13 0 1 1 25.35 12.9"
          fill="none"
          stroke="#F6F4EE"
          strokeWidth="5.5"
          strokeLinecap="round"
        />
        <circle cx="36.57" cy="11.43" r="4.75" fill="#CDAA6E" />
      </g>
    </svg>,
    size,
  );
}
