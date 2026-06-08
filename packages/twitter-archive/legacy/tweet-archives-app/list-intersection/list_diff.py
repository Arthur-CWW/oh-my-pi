#!/usr/bin/env python3
"""
Script to find the set difference between two Twitter lists with caching
"""

import json
import os
from typing import Set, Dict, Any
from pathlib import Path

# Cache directory
CACHE_DIR = Path(".cache")
CACHE_DIR.mkdir(exist_ok=True)

# List IDs from the URLs
LIST_1_ID = "1470591689521836034"
LIST_2_ID = "1968568357361455160"


def get_list_members_from_api(list_id: str) -> Set[str]:
    """Fetch list members from Twitter API"""
    import subprocess

    # Use curl to fetch the data
    curl_command = [
        "curl",
        "--request",
        "GET",
        "--url",
        f"https://twitter135.p.rapidapi.com/v2/ListMembers/?listId={list_id}&count=100",
        "--header",
        "x-rapidapi-host: twitter135.p.rapidapi.com",
        "--header",
        f"x-rapidapi-key: {os.environ.get('RAPIDAPI_KEY', '<set RAPIDAPI_KEY>')}",
    ]

    try:
        result = subprocess.run(
            curl_command, capture_output=True, text=True, check=True
        )
        data = json.loads(result.stdout)

        # Extract screen names from the response
        members = set()
        if "data" in data and "list" in data["data"]:
            timeline = data["data"]["list"]["members_timeline"]["timeline"]
            for instruction in timeline.get("instructions", []):
                if instruction.get("type") == "TimelineAddEntries":
                    for entry in instruction.get("entries", []):
                        content = entry.get("content", {})
                        if content.get("entryType") == "TimelineTimelineItem":
                            item_content = content.get("itemContent", {})
                            if item_content.get("itemType") == "TimelineUser":
                                user_results = item_content.get("user_results", {})
                                result = user_results.get("result", {})
                                if "legacy" in result:
                                    screen_name = result["legacy"].get("screen_name")
                                    if screen_name:
                                        members.add(screen_name)

        return members

    except subprocess.CalledProcessError as e:
        print(f"Error fetching list {list_id}: {e}")
        print(f"stderr: {e.stderr}")
        return set()
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON for list {list_id}: {e}")
        return set()


def get_list_members(list_id: str) -> Set[str]:
    """Get list members with caching"""
    cache_file = CACHE_DIR / f"list_{list_id}.json"

    # Try to read from cache first
    if cache_file.exists():
        try:
            with open(cache_file, "r") as f:
                cached_data = json.load(f)
                print(f"Using cached data for list {list_id}")
                return set(cached_data.get("members", []))
        except (json.JSONDecodeError, KeyError) as e:
            print(f"Cache corrupted for list {list_id}: {e}")

    # Fetch from API and cache
    print(f"Fetching list {list_id} from API...")
    members = get_list_members_from_api(list_id)

    # Cache the results
    cache_data = {"list_id": list_id, "members": list(members)}
    with open(cache_file, "w") as f:
        json.dump(cache_data, f, indent=2)

    return members


def main():
    print("Finding set difference between Twitter lists...")
    print(f"List 1: {LIST_1_ID}")
    print(f"List 2: {LIST_2_ID}")
    print()

    # Get members from both lists
    list1_members = get_list_members(LIST_1_ID)
    list2_members = get_list_members(LIST_2_ID)

    print(f"\nList 1 ({LIST_1_ID}) has {len(list1_members)} members")
    print(f"List 2 ({LIST_2_ID}) has {len(list2_members)} members")

    # Calculate set differences
    list1_only = list1_members - list2_members
    list2_only = list2_members - list1_members

    print(f"\nMembers only in List 1 ({len(list1_only)}):")
    for handle in sorted(list1_only):
        print(f"https://x.com/{handle}")

    print(f"\nMembers only in List 2 ({len(list2_only)}):")
    for handle in sorted(list2_only):
        print(f"https://x.com/{handle}")

    print(
        f"\nIntersection (in both lists): {len(list1_members & list2_members)} members"
    )


if __name__ == "__main__":
    main()
