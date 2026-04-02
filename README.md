# asciimap

```text
█████╗  ███████╗ ██████╗██╗██╗    ███╗   ███╗ █████╗ ██████╗
██╔══██╗██╔════╝██╔════╝██║██║    ████╗ ████║██╔══██╗██╔══██╗
███████║███████╗██║     ██║██║    ██╔████╔██║███████║██████╔╝
██╔══██║╚════██║██║     ██║██║    ██║╚██╔╝██║██╔══██║██╔═══╝
██║  ██║███████║╚██████╗██║██║    ██║ ╚═╝ ██║██║  ██║██║
╚═╝  ╚═╝╚══════╝ ╚═════╝╚═╝╚═╝    ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝
```

`asciimap` is a hobby project for experimenting with ASCII cartography in the browser.

https://github.com/user-attachments/assets/aab0f1fb-d16a-45c0-9003-873fa331fd2c

Try the live demo at [https://lionel-lim.github.io/asciimap/](https://lionel-lim.github.io/asciimap/).

## Stack

- SvelteKit (static build via `@sveltejs/adapter-static`)
- Pretext
- MapLibre GL JS

## Development

```sh
npm install
npm run dev
```

Useful commands:

```sh
npm run check
npm run lint
npm run test
npm run build
```

## Aircraft feed note

Aircraft data is fetched directly from Airplanes.live in the browser using its `/v2/point/{lat}/{lon}/{radius}` endpoint. The app converts the current map viewport into a center point and nautical-mile radius, so it remains deployable on GitHub Pages without a proxy.

Airplanes.live currently allows unauthenticated browser access for non-commercial use, documents a `1 request / second` rate limit, and provides no SLA or uptime guarantee. If the feed is unavailable or rate-limited, the map still renders and the aircraft layer shows an error status.

## Credits

### Data sources

- [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (map data)
- [OpenFreeMap](https://openfreemap.org/) (Liberty style and hosted tiles)
- [Airplanes.live](https://airplanes.live/api-guide/) (`/v2/point/{lat}/{lon}/{radius}` live aircraft states)

### Open-source libraries

- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [Pretext (`@chenglou/pretext`)](https://www.npmjs.com/package/@chenglou/pretext)
- [IBM Plex Mono via Fontsource (`@fontsource/ibm-plex-mono`)](https://www.npmjs.com/package/@fontsource/ibm-plex-mono)

## License

This repository is licensed under `AGPL-3.0-only`.

If you run a modified public version of this app over a network, the AGPL requires that you also make the corresponding source available.
