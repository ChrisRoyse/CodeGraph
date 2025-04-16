def format_data(data: dict) -> str:
    """
    Simple utility function to format data.
    """
    item_id = data.get("id", "N/A")
    value = data.get("value", "N/A")
    return f"Formatted Item [ID: {item_id}, Value: {value}]"