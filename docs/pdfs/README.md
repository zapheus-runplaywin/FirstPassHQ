# PDFs

Printable documents about FirstPass HQ, all made from the app at **build 854** (26 November 2026, commit a3f67a3, tag `build-854`). A build number is the number of commits on main; the Tag build workflow tags each one. Every screen is from the app itself, filled with made-up sample people. The source of truth for how the app works is the [user guide](../user-guide.md); these PDFs are snapshots of it, numbered by build.

They cover game day too: **FirstPass Vantage** (the statistician's tablet app) and **FirstPass Vision** (the coach's live view) are in the manual, the brochure, and the guides for statisticians, coaches, managers and admins, with screens of a made-up game, Hawks v Kestrels. **FirstPass Studio**, the live-stream graphics product, is separate and has its own guide; these PDFs mention it only where it uses the club's stats or a parent's consent.

| | West Coast Thunder | West Coast Warriors (a pitch) | FirstPass HQ (generic) |
| --- | --- | --- | --- |
| **Brochure** (20 pages): seven problems every club knows, how the app answers each one, and a spread on game day | [Brochure](thunder/West-Coast-Thunder-brochure-build-854.pdf) | [Brochure](warriors/West-Coast-Warriors-brochure-build-854.pdf) | [Brochure](generic/FirstPass-HQ-brochure-build-854.pdf) |
| **Product manual** (214 pages): every feature, screen by screen | [Manual](thunder/West-Coast-Thunder-product-manual-build-854.pdf) | [Manual](warriors/West-Coast-Warriors-product-manual-build-854.pdf) | [Manual](generic/FirstPass-HQ-product-manual-build-854.pdf) |

Each brochure also has a **print version** for a printer: A4 trim with 3 mm bleed and crop marks, on a 236 × 323 mm sheet ([Thunder](thunder/West-Coast-Thunder-brochure-print-build-854.pdf), [Warriors](warriors/West-Coast-Warriors-brochure-print-build-854.pdf), [generic](generic/FirstPass-HQ-brochure-print-build-854.pdf)). The versions above are for screens and office printers.

The Warriors edition never names another real club; its second club is the made-up Coastal Hawks. The generic edition uses FirstPass branding and a made-up Bayside Netball Club.

## User guides by role

One guide per role, for members to keep, in each edition. Each has getting started, what everyone can do, the role's own section and the child-safety parts written for that role. Someone with more than one role reads each of their roles' guides. The Warriors and generic editions name their own club throughout.

| Role | West Coast Thunder | West Coast Warriors | FirstPass HQ (generic) |
| --- | --- | --- | --- |
| Athletes | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-athletes-build-854.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-athletes-build-854.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-athletes-build-854.pdf) |
| Parents and guardians | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-guardians-build-854.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-guardians-build-854.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-guardians-build-854.pdf) |
| Coaches | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-coaches-build-854.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-coaches-build-854.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-coaches-build-854.pdf) |
| Managers | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-managers-build-854.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-managers-build-854.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-managers-build-854.pdf) |
| Committee | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-committee-build-854.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-committee-build-854.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-committee-build-854.pdf) |
| Physios | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-physios-build-854.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-physios-build-854.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-physios-build-854.pdf) |
| Guests | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-guests-build-854.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-guests-build-854.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-guests-build-854.pdf) |
| Statisticians | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-statisticians-build-854.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-statisticians-build-854.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-statisticians-build-854.pdf) |
| Temporary helpers | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-temporary-helpers-build-854.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-temporary-helpers-build-854.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-temporary-helpers-build-854.pdf) |
| Admins | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-admins-build-854.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-admins-build-854.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-admins-build-854.pdf) |

## Published guides

The user guides by role are also on the web, for the app and the public site to link to. The "Publish guides" workflow (`.github/workflows/publish-guides.yml`) puts them on GitHub Pages whenever new PDFs merge to main, under names that don't change from one build to the next:

- FirstPass HQ (generic): `https://zapheus-runplaywin.github.io/FirstPassHQ/guides/generic/user-guide-<role>.pdf`
- West Coast Thunder: `https://zapheus-runplaywin.github.io/FirstPassHQ/guides/thunder/user-guide-<role>.pdf`

`<role>` is `athletes`, `guardians`, `coaches`, `managers`, `committee`, `physios`, `guests`, `statisticians`, `temporary-helpers` or `admins`. `guides/index.json` beside them says which build is published.

- The app's **Help** cards in the Me tab open these (`src/lib/guides.ts`): a club with its own edition gets it, every other club gets the FirstPass HQ one. The guides page on the public site, `https://firstpass-hq.expo.app/guides`, links to them too.
- `scripts/build-guides-site.py` lays them out and refuses a set with a guide missing or from mixed builds (`scripts/test-build-guides-site.py`). The Warriors edition is a pitch and is never published; nor are the manuals and brochures.
- A club with its own edition: add its folder to `EDITIONS` in the script and its club code to `BRANDED_EDITIONS` in `src/lib/guides.ts`. The test keeps the two in step.
- Once, in the repository's settings: Settings > Pages > Build and deployment > Source: "GitHub Actions". Until then the workflow publishes nothing and says so.

## Rebuilding

The builders are in the project's shared files, `thunder/user-guide/manual/`: `make.py` with `build-manual.py` (the manual's content is `manual.yaml`), `build-role-guide.py` (set `ROLE`), `make-problems-brochure.py` (content in `build-problems-brochure.py`) for the brochure, and `print-bleed.py <screen.pdf> <print.pdf>` for its print version. They share one look, `cardstyle.py`. `build-all-850.sh <edition>` builds all thirteen PDFs of one edition. Warriors and generic screenshots are in `screens-850/` (its `REPORT.md` says how they were made). `make.py` prints each PDF until the page numbers on its contents page stop moving, then once more without the hidden page markers it uses to find them. Set `BUILD_REF=origin/main` to number the PDFs by the main commit they describe when building from a branch. The builders embed screenshots as JPEG to keep the files small: the 39 PDFs are about 297 MB together. Replace these files with a new build rather than keeping old builds side by side.
