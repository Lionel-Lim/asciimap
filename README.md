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

Aircraft data is fetched directly from OpenSky from the browser. If OpenSky blocks requests in your environment (CORS/network/rate limiting), the map still renders but the aircraft feed shows an error status.

## Credits

### Data sources

- [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (map data)
- [OpenFreeMap](https://openfreemap.org/) (Liberty style and hosted tiles)
- [The OpenSky Network](https://opensky-network.org/) (`/api/states/all` live aircraft states)

### Open-source libraries

- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [Pretext (`@chenglou/pretext`)](https://www.npmjs.com/package/@chenglou/pretext)
- [IBM Plex Mono via Fontsource (`@fontsource/ibm-plex-mono`)](https://www.npmjs.com/package/@fontsource/ibm-plex-mono)


## License

This repository is licensed under `AGPL-3.0-only`.

If you run a modified public version of this app over a network, the AGPL requires that you also make the corresponding source available.
