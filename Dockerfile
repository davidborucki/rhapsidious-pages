FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html app.js config.js clip-utils.js playback-window.js playback-queue.js profile-editor.js settings.js styles.css /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
