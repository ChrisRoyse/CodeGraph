# api_gateway/orchestration_logic/resolution.py
import logging
import re
from typing import Dict, List, Tuple, Any, Optional, Set, DefaultDict
from collections import defaultdict

# Import types and protobufs from defs
from .defs import (
    LocalKey, GlobalId, NodeRegistry, RelationshipMap, ImportInfo,
    DefinitionRegistry, ResolvedTargetMap, neo4j_ingestion_pb2
)
# Import helpers
from .helpers import parse_sql_query

logger = logging.getLogger(__name__)

def resolve_intra_language_calls(
    relationships_by_source: RelationshipMap,
    import_info: ImportInfo, # Still needs refinement on how this is structured/populated
    definition_registry: DefinitionRegistry,
    resolved_global_ids: Dict[LocalKey, GlobalId]
) -> ResolvedTargetMap:
    """
    Attempts to resolve CALLS targets across files using import information.
    Returns a map of (source_key, target_local_id) -> resolved_target_global_id.
    NOTE: This function is currently disabled in the main orchestration flow
          due to uncertainties in how import information is represented.
    """
    logger.info("Starting intra-language call resolution...")
    resolved_targets: ResolvedTargetMap = {}
    potential_call_rels = 0
    resolved_call_count = 0

    for source_key, rel_list in relationships_by_source.items():
        analyzer_name, file_path, source_local_id = source_key
        lang = analyzer_name.split('_')[0].lower() # Assuming analyzer name indicates language

        # --- TEMPORARY WORKAROUND: Find imports associated with the file ---
        # This section needs replacement with a robust way to access file-specific imports.
        file_imports = {}
        for imp_source_key, imports in import_info.items():
             # Assuming import_info keys might be file nodes or related keys
             if imp_source_key[0] == analyzer_name and imp_source_key[1] == file_path:
                 file_imports.update(imports)
        # --- END WORKAROUND ---

        if not file_imports:
            continue # No imports in this file to help resolve calls

        for rel in rel_list:
            if rel.relationship_type in ["CALLS", "CALLS_HINT"]:
                potential_call_rels += 1
                target_local_id = rel.target_node_local_id
                target_local_key = (analyzer_name, file_path, target_local_id)
                target_prelim_gid = resolved_global_ids.get(target_local_key)

                # Check if the target is already a known definition in the *same* file
                if target_prelim_gid and target_prelim_gid in definition_registry:
                    resolved_targets[(source_key, target_local_id)] = target_prelim_gid
                    continue # Already resolved locally

                # Attempt resolution via imports
                target_name = rel.properties.get("name", "") or rel.properties.get("identifier", "")
                if not target_name:
                    logger.debug(f"CALLS relationship from {source_key} to {target_local_id} has no 'name' property. Cannot resolve via import.")
                    continue

                resolved_via_import = False
                for alias, imported_entity in file_imports.items():
                    potential_target_gid = None
                    if target_name == alias:
                        potential_target_gid = f"{lang}::{imported_entity}"
                    elif target_name.startswith(alias + "."):
                        member_name = target_name.split(".", 1)[1]
                        potential_target_gid = f"{lang}::{imported_entity}.{member_name}"

                    if potential_target_gid:
                        if potential_target_gid in definition_registry:
                            resolved_targets[(source_key, target_local_id)] = potential_target_gid
                            resolved_call_count += 1
                            resolved_via_import = True
                            logger.debug(f"Resolved call '{target_name}' from {source_key} to {potential_target_gid} via import '{alias}'.")
                            break

                if not resolved_via_import:
                     logger.debug(f"Could not resolve call '{target_name}' from {source_key} via imports.")

    logger.info(f"Intra-language call resolution complete. Potential calls: {potential_call_rels}. Resolved via imports: {resolved_call_count}.")
    return resolved_targets


def resolve_cross_language_heuristics(
    final_nodes: Dict[GlobalId, neo4j_ingestion_pb2.GraphNode],
    # definition_registry: DefinitionRegistry, # Not strictly needed if final_nodes has types
    # resolved_global_ids: Dict[LocalKey, GlobalId], # Not needed here
    # nodes_by_local_key: NodeRegistry, # Not needed here
) -> List[neo4j_ingestion_pb2.GraphRelationship]:
    """
    Applies heuristics to find relationships across language boundaries.
    Generates new GraphRelationship objects based on final node types and properties.
    """
    logger.info("Starting cross-language heuristic resolution...")
    new_relationships: List[neo4j_ingestion_pb2.GraphRelationship] = []
    api_calls_resolved = 0
    db_queries_resolved = 0

    # --- Identify Potential Callers and Targets from final_nodes ---
    api_callers: List[neo4j_ingestion_pb2.GraphNode] = []
    api_endpoints: Dict[str, GlobalId] = {} # Normalized URL/path -> global_id
    db_query_nodes: List[neo4j_ingestion_pb2.GraphNode] = []
    db_tables: Dict[str, GlobalId] = {} # table_name -> global_id
    db_columns: Dict[str, GlobalId] = {} # column_name -> global_id (might need table context)

    for gid, node in final_nodes.items():
        node_type = node.node_type # Use the primary mapped type

        if node_type == "ApiCall":
            api_callers.append(node)
        elif node_type == "ApiEndpoint":
            path = node.properties.get("path", "").strip("/")
            if path:
                if path in api_endpoints:
                     logger.warning(f"Duplicate API endpoint path detected: '{path}'. GIDs: {api_endpoints[path]}, {gid}")
                api_endpoints[path] = gid
        elif node_type == "DatabaseQuery":
            db_query_nodes.append(node)
        elif node_type == "Table":
            name = node.properties.get("name", "")
            if name:
                 if name in db_tables:
                      logger.warning(f"Duplicate DB table name detected: '{name}'. GIDs: {db_tables[name]}, {gid}")
                 db_tables[name] = gid
        elif node_type == "Column":
             name = node.properties.get("name", "")
             if name:
                 # TODO: Consider table context for columns if names aren't unique globally
                 if name in db_columns:
                      logger.warning(f"Duplicate DB column name detected: '{name}'. GIDs: {db_columns[name]}, {gid}")
                 db_columns[name] = gid

    # --- API Call Matching ---
    logger.debug(f"Attempting to match {len(api_callers)} API callers against {len(api_endpoints)} endpoints.")
    for caller in api_callers:
        url = caller.properties.get("url", "") or caller.properties.get("path", "")
        if not url: continue

        match_path = url.split("?")[0].strip("/")
        # TODO: Handle base URLs, path parameters more robustly

        if match_path in api_endpoints:
            target_gid = api_endpoints[match_path]
            logger.info(f"Matched API call from {caller.global_id} (URL: {url}) to Endpoint {target_gid} (Path: {match_path})")
            new_relationships.append(neo4j_ingestion_pb2.GraphRelationship(
                source_node_global_id=caller.global_id,
                target_node_global_id=target_gid,
                relationship_type="CALLS_API",
                properties={"heuristic_match": "url_path"},
                location=caller.location # Location of the call site if available
            ))
            api_calls_resolved += 1
        else:
            logger.debug(f"No matching API endpoint found for call from {caller.global_id} (Path: {match_path})")

    # --- Database Query Matching ---
    logger.debug(f"Attempting to match {len(db_query_nodes)} DB queries against {len(db_tables)} tables and {len(db_columns)} columns.")
    for query_node in db_query_nodes:
        query_string = query_node.properties.get("query", "")
        if not query_string: continue

        parsed_sql = parse_sql_query(query_string)
        matched_this_query = False

        for table_name in parsed_sql["tables"]:
            if table_name in db_tables:
                target_gid = db_tables[table_name]
                logger.info(f"Matched DB query from {query_node.global_id} to Table {target_gid} (Name: {table_name})")
                rel_type = "QUERIES_TABLE" # Default
                if re.search(r'\bUPDATE\b', query_string, re.IGNORECASE) or \
                   re.search(r'\bINSERT\b', query_string, re.IGNORECASE) or \
                   re.search(r'\bDELETE\b', query_string, re.IGNORECASE):
                    rel_type = "MODIFIES_TABLE"
                elif re.search(r'\bSELECT\b', query_string, re.IGNORECASE):
                     rel_type = "READS_TABLE"

                new_relationships.append(neo4j_ingestion_pb2.GraphRelationship(
                    source_node_global_id=query_node.global_id,
                    target_node_global_id=target_gid,
                    relationship_type=rel_type,
                    properties={"heuristic_match": "table_name_in_query"},
                    location=query_node.location
                ))
                db_queries_resolved += 1
                matched_this_query = True

        for col_name in parsed_sql["columns"]:
             if col_name in db_columns:
                 target_gid = db_columns[col_name]
                 logger.info(f"Matched DB query from {query_node.global_id} uses Column {target_gid} (Name: {col_name})")
                 new_relationships.append(neo4j_ingestion_pb2.GraphRelationship(
                     source_node_global_id=query_node.global_id,
                     target_node_global_id=target_gid,
                     relationship_type="USES_COLUMN",
                     properties={"heuristic_match": "column_name_in_query"},
                     location=query_node.location
                 ))
                 matched_this_query = True # Counted column usage

        if not matched_this_query:
             logger.debug(f"No matching table/column found for query from {query_node.global_id}")

    logger.info(f"Cross-language heuristic resolution complete. New relationships: {len(new_relationships)} (API: {api_calls_resolved}, DB Table Matches: {db_queries_resolved})")
    return new_relationships