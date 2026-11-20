# PDFs

Printable documents about FirstPass HQ, all made from the app at **build 714** (20 November 2026, commit 694bd7a, tag `build-714`). A build number is the number of commits on main; the Tag build workflow tags each one. Every screen is from the app itself, filled with made-up sample people. The source of truth for how the app works is the [user guide](../user-guide.md); these PDFs are snapshots of it, numbered by build.

They cover game day too: **FirstPass Vantage** (the statistician's tablet app) and **FirstPass Vision** (the coach's live view) are in the manual, the brochure, and the guides for statisticians, coaches, managers and admins, with screens of a made-up game, Hawks v Kestrels. **FirstPass Studio**, the live-stream graphics product, is separate and has its own guide; these PDFs mention it only where it uses the club's stats or a parent's consent.

| | West Coast Thunder | West Coast Warriors (a pitch) | FirstPass HQ (generic) |
| --- | --- | --- | --- |
| **Brochure** (20 pages): seven problems every club knows, how the app answers each one, and a spread on game day | [Brochure](thunder/West-Coast-Thunder-brochure-build-714.pdf) | [Brochure](warriors/West-Coast-Warriors-brochure-build-714.pdf) | [Brochure](generic/FirstPass-HQ-brochure-build-714.pdf) |
| **Product manual** (157 pages): every feature, screen by screen | [Manual](thunder/West-Coast-Thunder-product-manual-build-714.pdf) | [Manual](warriors/West-Coast-Warriors-product-manual-build-714.pdf) | [Manual](generic/FirstPass-HQ-product-manual-build-714.pdf) |

Each brochure also has a **print version** for a printer: A4 trim with 3 mm bleed and crop marks, on a 236 × 323 mm sheet ([Thunder](thunder/West-Coast-Thunder-brochure-print-build-714.pdf), [Warriors](warriors/West-Coast-Warriors-brochure-print-build-714.pdf), [generic](generic/FirstPass-HQ-brochure-print-build-714.pdf)). The versions above are for screens and office printers.

The Warriors edition never names another real club; its second club is the made-up Coastal Hawks. The generic edition uses FirstPass branding and a made-up Bayside Netball Club.

## User guides by role

One guide per role, for members to keep, in each edition. Each has getting started, what everyone can do, the role's own section and the child-safety parts written for that role. Someone with more than one role reads each of their roles' guides. The Warriors and generic editions name their own club throughout.

| Role | West Coast Thunder | West Coast Warriors | FirstPass HQ (generic) |
| --- | --- | --- | --- |
| Athletes | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-athletes-build-714.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-athletes-build-714.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-athletes-build-714.pdf) |
| Parents and guardians | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-guardians-build-714.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-guardians-build-714.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-guardians-build-714.pdf) |
| Coaches | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-coaches-build-714.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-coaches-build-714.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-coaches-build-714.pdf) |
| Managers | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-managers-build-714.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-managers-build-714.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-managers-build-714.pdf) |
| Committee | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-committee-build-714.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-committee-build-714.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-committee-build-714.pdf) |
| Physios | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-physios-build-714.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-physios-build-714.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-physios-build-714.pdf) |
| Guests | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-guests-build-714.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-guests-build-714.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-guests-build-714.pdf) |
| Statisticians | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-statisticians-build-714.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-statisticians-build-714.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-statisticians-build-714.pdf) |
| Temporary helpers | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-temporary-helpers-build-714.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-temporary-helpers-build-714.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-temporary-helpers-build-714.pdf) |
| Admins | [Thunder](thunder/user-guides/West-Coast-Thunder-user-guide-admins-build-714.pdf) | [Warriors](warriors/user-guides/West-Coast-Warriors-user-guide-admins-build-714.pdf) | [Generic](generic/user-guides/FirstPass-HQ-user-guide-admins-build-714.pdf) |

## Rebuilding

The builders are in the project's shared files, `thunder/user-guide/manual/`: `make.py` with `build-manual.py` (the manual's content is `manual.yaml`), `build-role-guide.py` (set `ROLE`), `make-problems-brochure.py` (content in `build-problems-brochure.py`) for the brochure, and `print-bleed.py <screen.pdf> <print.pdf>` for its print version. They share one look, `cardstyle.py`. Warriors and generic screenshots are in `screens-694/` (its `REPORT.md` says how they were made). `make.py` prints each PDF until the page numbers on its contents page stop moving, then once more without the hidden page markers it uses to find them. Set `BUILD_REF=origin/main` to number the PDFs by the main commit they describe when building from a branch. The builders embed screenshots as JPEG to keep the files small: the 39 PDFs are about 229 MB together. Replace these files with a new build rather than keeping old builds side by side.
