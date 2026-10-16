# PDFs

Printable documents about FirstPass HQ, all made from the app at **build 340** (16 October 2026, tag `build-340`, commit 67c82f2). A build number is the number of commits on main; the Tag build workflow tags each one. Every screen is from the app itself, filled with made-up sample people. The source of truth for how the app works is the [user guide](../user-guide.md); these PDFs are snapshots of it, numbered by build.

| | West Coast Thunder | West Coast Warriors (a pitch) | FirstPass HQ (generic) |
| --- | --- | --- | --- |
| **Brochure** (12 pages): the short sales piece for a president and committee | [Brochure](thunder/West-Coast-Thunder-brochure-build-340.pdf) | [Brochure](warriors/West-Coast-Warriors-brochure-build-340.pdf) | [Brochure](generic/FirstPass-HQ-brochure-build-340.pdf) |
| **Product manual** (90 pages): every feature, screen by screen | [Manual](thunder/West-Coast-Thunder-product-manual-build-340.pdf) | [Manual](warriors/West-Coast-Warriors-product-manual-build-340.pdf) | [Manual](generic/FirstPass-HQ-product-manual-build-340.pdf) |

Each brochure also has a **print version** for a printer: A4 trim with 3 mm bleed and crop marks, on a 236 × 323 mm sheet ([Thunder](thunder/West-Coast-Thunder-brochure-print-build-340.pdf), [Warriors](warriors/West-Coast-Warriors-brochure-print-build-340.pdf), [generic](generic/FirstPass-HQ-brochure-print-build-340.pdf)). The versions above are for screens and office printers.

The Warriors edition never names another real club; its second club is the made-up Coastal Hawks. The generic edition uses FirstPass branding and a made-up Bayside Netball Club.

## User guides by role (West Coast Thunder)

One guide per role, for members to keep. Each has getting started, what everyone can do, the role's own section and the child-safety parts written for that role. Someone with more than one role reads each of their roles' guides.

- [Athletes](thunder/user-guides/West-Coast-Thunder-user-guide-athletes-build-340.pdf)
- [Parents and guardians](thunder/user-guides/West-Coast-Thunder-user-guide-guardians-build-340.pdf)
- [Coaches](thunder/user-guides/West-Coast-Thunder-user-guide-coaches-build-340.pdf)
- [Managers](thunder/user-guides/West-Coast-Thunder-user-guide-managers-build-340.pdf)
- [Committee](thunder/user-guides/West-Coast-Thunder-user-guide-committee-build-340.pdf)
- [Physios](thunder/user-guides/West-Coast-Thunder-user-guide-physios-build-340.pdf)
- [Guests](thunder/user-guides/West-Coast-Thunder-user-guide-guests-build-340.pdf)
- [Temporary helpers](thunder/user-guides/West-Coast-Thunder-user-guide-temporary-helpers-build-340.pdf)
- [Admins](thunder/user-guides/West-Coast-Thunder-user-guide-admins-build-340.pdf)

## Rebuilding

The builders are in the project's shared files, `thunder/user-guide/manual/`: `make.py` with `build-manual.py` (the manual's content is `manual.yaml`), `build-role-guide.py` (set `ROLE`), `make-brochure-cards.py` for the brochure, and `print-bleed.py <screen.pdf> <print.pdf>` for its print version. They share one look, `cardstyle.py`. Warriors and generic screenshots are in `screens-332/`. Replace these files with a new build rather than keeping old builds side by side.
