import datetime
import json
import re
import shutil
import subprocess

vm = subprocess.check_output(["vm_stat"], text=True)
page_size = int(re.search(r"page size of (\d+)", vm).group(1))
pages = {key: int(value) for key, value in re.findall(r"([^\n:]+):\s*(\d+)\.", vm)}
selected = {key: pages[key] for key in ["Pages free", "Pages inactive", "Pages speculative"]}
available = sum(selected.values()) * page_size
pressure = int(subprocess.check_output(["sysctl", "-n", "kern.memorystatus_vm_pressure_level"], text=True).strip())
cpu_line = subprocess.check_output(["top", "-l", "1", "-n", "0"], text=True).split("CPU usage:")[1].split("\n")[0].strip()
idle = float(re.search(r"([0-9.]+)% idle", cpu_line).group(1))
disk_free = shutil.disk_usage(".").free
print(json.dumps({"at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "pageSize": page_size, "pages": selected, "availableBytes": available,
 "availableGiB": round(available / 1024**3, 3), "pressure": pressure,
 "cpuIdlePercent": idle, "cpu": cpu_line, "diskFreeBytes": disk_free,
 "diskFreeGiB": round(disk_free / 1024**3, 3),
 "heavyEligible": pressure in [1, 2] and available >= 4 * 1024**3 and idle >= 50 and disk_free >= 8 * 1024**3}))
