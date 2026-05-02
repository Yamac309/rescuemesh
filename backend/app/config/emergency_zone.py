import os


def get_emergency_zone() -> dict:
    return {
        "minLatitude": float(os.getenv("RESCUEMESH_ZONE_MIN_LAT", "40.7000")),
        "maxLatitude": float(os.getenv("RESCUEMESH_ZONE_MAX_LAT", "40.7250")),
        "minLongitude": float(os.getenv("RESCUEMESH_ZONE_MIN_LON", "-74.0200")),
        "maxLongitude": float(os.getenv("RESCUEMESH_ZONE_MAX_LON", "-73.9900")),
    }


def get_node_id() -> str:
    return os.getenv("RESCUEMESH_NODE_ID", "local-node")
