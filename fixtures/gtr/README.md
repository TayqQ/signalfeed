# Gateway to Research fixtures

Shapes captured from the live legacy API (`https://gtr.ukri.org/gtr/api/`) on 11 November 2026.

- `projects-page.json`: a trimmed `projects.json` page with three projects.
- `organisation.json`: one `organisations/{id}` response.

## What was changed

- Every organisation name, id, title, abstract and identifier is invented. Nothing real remains.
- Every person link (`PM_PER`, `EMPLOYEE`) is removed. Person endpoints are never called.
- `totalSize` and `size` are set to 3 so the page looks complete.
- `regNumber`, `website` and the postcode on the organisation are invented (live responses often have `regNumber: null`).
- The structure is unchanged: `links`, `participantValues.participant[]`, the `FUND` link with `start` and `end` in milliseconds, and `addresses.address[]`.

Project 3 has a university lead and a participant with no company form, so the organisation rule skips both.
