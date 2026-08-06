import json
import subprocess
from typing import List, Dict

DEFAULT_ORG = "tcd-company"


def query(soql: str, target_org: str = DEFAULT_ORG) -> List[Dict]:
    """`sf data query` を実行し、レコードのリストを返す。"""
    result = subprocess.run(
        ["sf", "data", "query", "--query", soql, "--target-org", target_org, "--json"],
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(result.stdout)
    return payload["result"]["records"]
