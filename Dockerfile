FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html app.js episode-sources.js upload-limits.js config.js clip-utils.js playback-window.js playback-queue.js profile-editor.js settings.js support-inbox.js creator-tracking.js creator-analytics.js creator-analytics.css styles.css /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets

COPY privacy-policy /usr/share/nginx/html/privacy-policy
COPY terms-of-service /usr/share/nginx/html/terms-of-service
COPY support /usr/share/nginx/html/support
COPY copyright-takedown /usr/share/nginx/html/copyright-takedown

COPY legal-assets /usr/share/nginx/html/legal-assets
