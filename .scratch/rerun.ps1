$body = @{
  prompt = "Build a full-stack social media platform like Facebook. Include: user authentication (sign up, login, logout, password reset), user profiles with avatar/bio/cover photo, a news feed with posts (text+image), create/edit/delete posts, like and comment, friend requests and friends list, real-time chat/direct messages, notifications, search for users/posts, settings page, responsive mobile-friendly UI, polished modern design. Use Next.js 15 App Router with API routes and an in-memory data store seeded with demo users and posts."
} | ConvertTo-Json
$res = Invoke-RestMethod -Uri "http://localhost:3003/api/projects/generate" -Method POST -Body $body -ContentType "application/json"
$res | ConvertTo-Json -Depth 4
