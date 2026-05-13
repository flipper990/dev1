export const AUTH_COOKIE_NAMES = {
  accessToken: 'devteam_access_token',
  legacyAccessToken: 'devteam_auth_token',
  refreshToken: 'devteam_refresh_token',
  csrfToken: 'devteam_csrf_token',
} as const;

export const AUTH_COOKIE_PATHS = {
  accessToken: '/',
  refreshToken: '/api/auth',
  csrfToken: '/',
} as const;

