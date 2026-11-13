# Companies House SIC list build

`build-sic-codes.ts` writes one committed lookup from open data:

- `src/lib/registry/sic-codes.json`: the condensed UK SIC 2007 list used on the Companies House register, 731 five-digit codes with descriptions (about 41 KB).

Tests never run it and never touch the network. Run it only if the list changes (it has not changed since 2008).

## Source and licence

- Source: "SIC07_CH_condensed_list_en.csv", from the GOV.UK page "Standard industrial classification of economic activities (SIC)" (Companies House), `https://www.gov.uk/government/publications/standard-industrial-classification-of-economic-activities-sic`.
- File URL: `https://assets.publishing.service.gov.uk/media/5a7f8639e5274a2e87db65e1/SIC07_CH_condensed_list_en.csv`
- Checked and downloaded: 12 November 2026. The page shows its licence as **Open Government Licence v3.0**, and gives 1 January 2008 as the publication date.
- Attribution: "Contains public sector information licensed under the Open Government Licence v3.0."

The build only tidies spaces and capitalises the first letter of a description ("specialised design activities" becomes "Specialised design activities"). Wording is otherwise as published.

## Download and build

Use a new, empty folder outside the repository, for example `/private/tmp/claude-501/sic-downloads`. Do not run Python or build tools from inside it. Delete the folder afterwards.

```sh
mkdir /private/tmp/claude-501/sic-downloads
curl -L "https://assets.publishing.service.gov.uk/media/5a7f8639e5274a2e87db65e1/SIC07_CH_condensed_list_en.csv" -o /private/tmp/claude-501/sic-downloads/sic.csv
pnpm exec tsx scripts/registry/build-sic-codes.ts /private/tmp/claude-501/sic-downloads/sic.csv
rm -r /private/tmp/claude-501/sic-downloads
```

The script stops on a code that is not five digits, a repeated code, or a missing description.

## Related lookups (hand-written, not built)

- `src/lib/registry/sic-sectors.ts`: SIC to the 16 sectors. A rule table (division, then 5-digit exceptions). The judgement calls and the vague codes are listed in the comment at the top. Bump `SIC_SECTOR_MAP_VERSION` when the table changes.
- `src/lib/registry/ch-labels.ts`: status and company type wording, copied from the Companies House `api-enumerations` constants (`constants.yml`, checked 12 November 2026).
