# Philippine address reference data

The application uses the Philippine Statistics Authority's Philippine Standard Geographic Code (PSGC), **as of 30 September 2026**. The [PSA release](https://psa.gov.ph/classification/psgc/) reports 18 regions, 82 provinces, 149 cities, 1,493 municipalities, and 42,010 barangays. It says the only geographic change from the 30 June 2026 release is the correction of barangay **Lambangan** to **Lambagan** in Cabanglasan, Bukidnon (code `1001322005`).

The static JSON was prepared on **16 November 2026** from [Tenasia/ph-psgc, tag `2026-Q2`](https://github.com/Tenasia/ph-psgc/tree/2026-Q2), which derives its codes and names from PSA's June 2026 publication. The one PSA-documented September correction above was applied to `areas/1001300000.json`. The official September workbook was not directly downloaded because the PSA site returned HTTP 403 to the automated downloader. The source repository's JSON packaging is MIT licensed; PSGC codes and names are credited to the Philippine Statistics Authority under [CC BY 4.0](https://psa.gov.ph/classification/psgc/).

`src/app/data/psgcIndex.json` contains regions, provinces, and independent cities. The 118 files in `areas/` contain cities, municipalities, and barangays, loaded only when an area is selected. The index lists BARMM's **Special Geographic Area** alongside provinces for navigation; it is not counted as an 83rd province. Tests check counts, codes, parent relationships, and the September correction.

To update this reference, obtain a newer official PSA publication, regenerate the index and area files, compare its totals with the PSA summary, and rerun the geographic data tests. Do not add sample places by hand.
