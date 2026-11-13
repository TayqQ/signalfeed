# UK geography build

`build-uk-geo.ts` writes the two committed lookups from open data:

- `src/lib/geo/uk-places.json`: GB and Northern Ireland cities and towns.
- `src/lib/geo/uk-outcodes.json`: GB postcode districts with a centroid and ITL1 code.

Tests never run it and never touch the network. Run it only when the source data should be refreshed (about once a year).

## Licences

All sources are under the Open Government Licence v3.0. Sources and attribution are recorded in `docs/sources.md` (A21-A23). Check the `licence.txt` in each zip before you rebuild, in case the terms change.

Northern Ireland postcodes are not open for commercial use, so there are no `BT` outcodes in the file.

## Download

Use one folder outside the repository, for example `/tmp/geo-downloads`. Do not run Python or build tools from inside it.

1. OS Open Names (GB, CSV, about 103 MB). Unzip into `opennames/`, so that `opennames/Data/*.csv` and `opennames/Doc/OS_Open_Names_Header.csv` exist.

   ```sh
   curl -L "https://api.os.uk/downloads/v1/products/OpenNames/downloads?area=GB&format=CSV&redirect" -o opname_csv_gb.zip
   unzip opname_csv_gb.zip -d opennames
   ```

2. Code-Point Open (GB, CSV, about 14 MB). Unzip into `codepoint/`, so that `codepoint/Data/CSV/*.csv` exists.

   ```sh
   curl -L "https://api.os.uk/downloads/v1/products/CodePointOpen/downloads?area=GB&format=CSV&redirect" -o codepo_gb.zip
   unzip codepo_gb.zip -d codepoint
   ```

3. NISRA Settlement Development Limits 2015 (GeoJSON, about 8 MB). Save as `ni/settlements-2015.json`.

   ```sh
   mkdir ni
   curl -L -A "Mozilla/5.0" "https://admin.opendatani.gov.uk/dataset/e3757f15-4833-496f-882a-8968c98f3cb4/resource/a1daf6e3-83da-4729-b444-84c7cfca18cc/download/settlements-2015.json" -o ni/settlements-2015.json
   ```

The product pages list the current download links: [OS Open Names](https://api.os.uk/downloads/v1/products/OpenNames/downloads), [Code-Point Open](https://api.os.uk/downloads/v1/products/CodePointOpen/downloads) and [the OpenDataNI dataset](https://www.opendatani.gov.uk/dataset/settlement-development-limits-2015).

## Build

```sh
pnpm exec tsx scripts/geo/build-uk-geo.ts /tmp/geo-downloads
```

It takes about 20 seconds. The script refuses a downloads folder inside the repository. An optional second argument sets the output folder (default `src/lib/geo`). The output is sorted and formatted with Prettier, so the same inputs give the same files. There is no package script on purpose.

Then run `pnpm exec vitest run src/lib/geo` and review the diff of the JSON files.

## How it works

- **Places:** Open Names `City` and `Town` records. English names are preferred, with Welsh and Gaelic names kept as aliases. A few aliases ("Greater London", "Hull", "Newcastle") are added in the script. "City of London" is folded into London.
- **Slugs:** a repeated name gets the county or council area, then the district, then the nation (`newport-wales`, `newport-isle-of-wight`).
- **Population band:** postcode units in Open Names whose populated place is the town, times 39 residents. For Northern Ireland, occupied households times 2.4. Bands: 1 under 10k, 2 from 10k, 3 from 25k, 4 from 100k, 5 from 250k, 6 from 1M.
- **Northern Ireland:** settlement bands A to F, minus the "Metropolitan" sub-areas of Belfast. The point is the area-weighted centroid of the outlines.
- **Outcodes:** the mean easting and northing of Code-Point Open units (ignoring units with no position), converted to WGS84. ITL1 is the most common area among that outcode's postcode records in Open Names.
- **Coordinates:** National Grid to WGS84 with a seven-parameter Helmert transform, accurate to about 5 m. Output is rounded to 4 decimal places.
