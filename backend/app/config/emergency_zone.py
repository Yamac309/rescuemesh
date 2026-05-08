import os


def get_emergency_zone() -> dict:
    return {
        "minLatitude": float(os.getenv("RESCUEMESH_ZONE_MIN_LAT", "24.396308")),
        "maxLatitude": float(os.getenv("RESCUEMESH_ZONE_MAX_LAT", "49.384358")),
        "minLongitude": float(os.getenv("RESCUEMESH_ZONE_MIN_LON", "-124.848974")),
        "maxLongitude": float(os.getenv("RESCUEMESH_ZONE_MAX_LON", "-66.885444")),
    }


def get_node_id() -> str:
    return os.getenv("RESCUEMESH_NODE_ID", "local-node")
