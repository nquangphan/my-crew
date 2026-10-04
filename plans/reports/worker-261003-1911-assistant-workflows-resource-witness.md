# Gateway manifest GREEN resource witness

Each row transcribes the tool output captured immediately before the named process launch. Page size from `sysctl -n hw.pagesize` was 16,384 bytes each time. Available GiB = (free + inactive + speculative pages) / 65,536. `memory_pressure -Q` gives a system-wide free percentage, not the pressure-level ordinal; PM supplied pressure level 2 at slot release, with no per-launch ordinal independently captured. The correct host key is `sysctl -n kern.memorystatus_vm_pressure_level`; it was not used in these historical preflights. No RED pressure/available-memory claim is backfilled.

| Launch | Free pages | Inactive pages | Speculative pages | Available GiB | CPU idle | Disk GiB available | `memory_pressure -Q` free |
|---|---:|---:|---:|---:|---:|---:|---:|
| First focused GREEN test | 9,105 | 266,755 | 6,081 | 4.302 | 52.28% | 27 | 36% |
| First typecheck | 9,792 | 269,293 | 2,151 | 4.291 | 56.50% | 27 | 36% |
| First Biome, formatting failure | 281,686 | 180,424 | 3,103 | 7.099 | 68.21% | 25 | 39% |
| Final Biome | 180,747 | 264,315 | 13,090 | 6.991 | 87.14% | 25 | 48% |
| Final typecheck | 126,551 | 294,401 | 15,446 | 6.659 | 79.18% | 25 | 48% |
| Final focused GREEN test | 136,353 | 290,333 | 17,195 | 6.773 | 85.28% | 25 | 48% |

The first Biome check reported formatting/import ordering only; owned files were reformatted manually, then final Biome/typecheck/test ran against the frozen source. No additional process was launched after the sole-heavy slot was released.
