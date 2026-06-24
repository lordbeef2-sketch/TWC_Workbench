import { Box, Stack, Typography } from "@mui/material";

type WorkbenchBrandMarkProps = {
  size?: number;
  titleVariant?: "h4" | "h5" | "h6";
  subtitle?: string;
  subtitleColor?: string;
  titleColor?: string;
};

export default function WorkbenchBrandMark({
  size = 44,
  titleVariant = "h6",
  subtitle,
  subtitleColor = "text.secondary",
  titleColor = "inherit",
}: WorkbenchBrandMarkProps) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Box
        component="span"
        aria-hidden="true"
        sx={{
          width: size,
          height: size,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="twcWorkbenchGradient" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
              <stop stopColor="#1F6FD5" />
              <stop offset="1" stopColor="#17B26A" />
            </linearGradient>
          </defs>
          <rect x="6" y="6" width="52" height="52" rx="12" fill="url(#twcWorkbenchGradient)" />
          <path
            d="M18 21H46L39.5 28H34V43H29V28H24.5L18 21Z"
            fill="white"
            fillOpacity="0.96"
          />
          <path
            d="M22 39.5L28.5 33L33 37.5L42 28.5"
            stroke="white"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Box>
      <Stack spacing={0.25} minWidth={0}>
        <Typography variant={titleVariant} noWrap sx={{ color: titleColor, lineHeight: 1.05 }}>
          TWC WorkBench
        </Typography>
        {subtitle ? (
          <Typography variant="body2" sx={{ color: subtitleColor, lineHeight: 1.25 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Stack>
    </Stack>
  );
}
