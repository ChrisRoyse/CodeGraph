# api_gateway/orchestration.py
import logging
from typing import Dict, List, Tuple, Any, Optional, Set, DefaultDict
from collections import defaultdict

# --- gRPC Imports ---
# Moved to defs.py, but check loading status here
from orchestration_logic.defs import ( # Use absolute import
    GRPC_MODULES_LOADED, analyzer_pb2, neo4j_ingestion_pb2,
    LocalKey, GlobalId, NodeRegistry, RelationshipMap, CandidateRegistry,
    ImportInfo, DefinitionRegistry, ResolvedTargetMap, REL_TYPE_MAP,
    DEFINITION_NODE_TYPES
)

# --- Orchestration Logic Imports ---
from orchestration_logic.helpers import ( # Use absolute import
    generate_preliminary_global_id, get_final_node_labels
)
from orchestration_logic.resolution import ( # Use absolute import
    resolve_intra_language_calls, resolve_cross_language_heuristics
)

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Main Orchestration Function ---

def orchestrate_results(analysis_results: List[analyzer_pb2.AnalysisResult]) -> Tuple[List[neo4j_ingestion_pb2.GraphNode], List[neo4j_ingestion_pb2.GraphRelationship]]:
    """
    Aggregates results from multiple analyzers, resolves IDs/types, applies heuristics,
    and creates unified GraphNode and GraphRelationship messages for ingestion.
    """
    if not GRPC_MODULES_LOADED:
        logger.error("Orchestration gRPC modules not loaded. Cannot perform orchestration.")
        return [], []
    if not analysis_results:
        logger.info("No analysis results provided for orchestration.")
        return [], []

    logger.info(f"Starting orchestration for {len(analysis_results)} analysis results.")

    # --- Data Structures ---
    nodes_by_local_key: NodeRegistry = {}
    relationships_by_source: RelationshipMap = defaultdict(list)
    nodes_by_candidate_id: CandidateRegistry = defaultdict(list)
    # TODO: Refine how import_info is populated and structured
    import_info: ImportInfo = defaultdict(dict)
    resolved_global_ids: Dict[LocalKey, GlobalId] = {}
    definition_registry: DefinitionRegistry = {}
    final_nodes: Dict[GlobalId, neo4j_ingestion_pb2.GraphNode] = {}
    final_relationships: List[neo4j_ingestion_pb2.GraphRelationship] = []

    # --- Pass 1: Collect Nodes, Relationships, and Basic Info ---
    logger.info("Orchestration - Pass 1: Collecting nodes and relationships...")
    valid_results_count = 0
    total_nodes = 0
    total_rels = 0
    for result in analysis_results:
        if not result or result.status != "SUCCESS":
            logger.warning(f"Skipping failed/missing result: Analyzer={getattr(result, 'analyzer_name', 'N/A')}, File={getattr(result, 'file_path', 'N/A')}, Status={getattr(result, 'status', 'N/A')}")
            continue
        valid_results_count += 1
        analyzer_name = result.analyzer_name
        file_path = result.file_path

        for node in result.nodes:
            total_nodes += 1
            local_key: LocalKey = (analyzer_name, file_path, node.local_id)
            if local_key in nodes_by_local_key:
                logger.warning(f"Duplicate local key found: {local_key}. Overwriting node.")
            nodes_by_local_key[local_key] = node
            if node.global_id_candidate:
                nodes_by_candidate_id[node.global_id_candidate].append(local_key)
            # Basic import info extraction placeholder - needs refinement
            # if node.node_type == "Import": pass

        for rel in result.relationships:
            total_rels += 1
            source_key: LocalKey = (analyzer_name, file_path, rel.source_node_local_id)
            relationships_by_source[source_key].append(rel)
            # Basic import info extraction placeholder - needs refinement
            # if rel.relationship_type == "IMPORTS": pass

    logger.info(f"Pass 1 Complete: Processed {valid_results_count}/{len(analysis_results)} valid results. Found {total_nodes} nodes, {total_rels} relationships.")

    # --- Pass 2: Assign Preliminary Global IDs and Build Definition Registry ---
    logger.info("Orchestration - Pass 2: Assigning preliminary Global IDs and building definition registry...")
    for local_key, node in nodes_by_local_key.items():
        analyzer_name, file_path, _ = local_key
        global_id = generate_preliminary_global_id(node, analyzer_name, file_path)
        resolved_global_ids[local_key] = global_id

        lang = node.properties.get("language", analyzer_name.split('_')[0]).lower()
        final_labels = get_final_node_labels(node.node_type, lang)
        is_definition = any(label in DEFINITION_NODE_TYPES for label in final_labels)

        if is_definition:
            if global_id in definition_registry:
                logger.warning(f"Duplicate definition found for global_id '{global_id}'. Original: {definition_registry[global_id]}, New: {local_key}. Keeping original.")
            else:
                definition_registry[global_id] = local_key

    logger.info(f"Pass 2 Complete: Assigned preliminary global IDs to {len(resolved_global_ids)} nodes. Found {len(definition_registry)} potential definition nodes.")

    # --- Pass 2.5: Resolve Relationships (Intra-language - currently disabled) ---
    # resolved_call_targets = resolve_intra_language_calls(
    #     relationships_by_source, import_info, definition_registry, resolved_global_ids
    # )
    resolved_call_targets: ResolvedTargetMap = {} # Keep empty as the function is disabled/needs work
    logger.warning("Skipping intra-language call resolution due to incomplete import representation.")

    # --- Pass 3: Construct Final Graph Components ---
    logger.info("Orchestration - Pass 3: Constructing final graph components...")
    final_node_count = 0
    final_rel_count = 0
    skipped_rels_count = 0

    # Create Final Nodes (Map types first for heuristics)
    for local_key, node in nodes_by_local_key.items():
        global_id = resolved_global_ids.get(local_key)
        if not global_id: continue # Already logged in Pass 2 if missing

        analyzer_name, file_path, _ = local_key
        lang = node.properties.get("language", analyzer_name.split('_')[0]).lower()
        final_labels = get_final_node_labels(node.node_type, lang)
        primary_label = final_labels[0]

        props = dict(node.properties) if node.properties else {}
        props["analyzer"] = analyzer_name
        props["language"] = lang
        props["original_node_type"] = node.node_type
        props["original_file_path"] = file_path
        if 'name' not in props and 'identifier' in props:
             props['name'] = props['identifier']
        props["neo4j_labels"] = final_labels # Store labels

        if global_id not in final_nodes:
            final_nodes[global_id] = neo4j_ingestion_pb2.GraphNode(
                global_id=global_id,
                node_type=primary_label,
                properties=props,
                location=node.location,
                code_snippet=node.code_snippet
            )
            final_node_count += 1
        else:
            # TODO: Implement robust property merging if needed
            logger.debug(f"Node {global_id} already exists. Merging not implemented.")
            pass

    # Apply Cross-Language Heuristics
    heuristic_relationships = resolve_cross_language_heuristics(final_nodes)
    final_relationships.extend(heuristic_relationships)
    final_rel_count += len(heuristic_relationships)

    # Create Final Relationships (from original analyzers)
    for source_local_key, rel_list in relationships_by_source.items():
        source_global_id = resolved_global_ids.get(source_local_key)
        if not source_global_id or source_global_id not in final_nodes:
            skipped_rels_count += len(rel_list)
            continue

        analyzer_name, file_path, _ = source_local_key

        for rel in rel_list:
            target_local_id = rel.target_node_local_id
            target_global_id = None

            # Check if resolved via imports (currently disabled)
            resolved_target_gid = resolved_call_targets.get((source_local_key, target_local_id))
            if resolved_target_gid:
                target_global_id = resolved_target_gid
            else:
                target_local_key = (analyzer_name, file_path, target_local_id)
                target_global_id = resolved_global_ids.get(target_local_key)

            if not target_global_id or target_global_id not in final_nodes:
                logger.warning(f"Rel {rel.relationship_type} from {source_global_id}: Target {target_local_key} (resolved as {target_global_id}) not found. Skipping.")
                skipped_rels_count += 1
                continue

            target_node = final_nodes[target_global_id] # Get target node for type refinement

            # Map relationship type
            final_rel_type = REL_TYPE_MAP.get(rel.relationship_type, "RELATED_TO")

            # Refine relationship type based on resolved node types
            if final_rel_type == "CALLS" and target_node.node_type == "ApiEndpoint":
                 final_rel_type = "CALLS_API"
            elif final_rel_type == "QUERIES" and target_node.node_type == "Table":
                 final_rel_type = "QUERIES_TABLE"
            elif final_rel_type == "ACCESSES" and target_node.node_type == "Column":
                 final_rel_type = "USES_COLUMN"
            # Add more refinement rules...

            # Avoid duplicates created by heuristics
            is_duplicate = any(
                hr.source_node_global_id == source_global_id and
                hr.target_node_global_id == target_global_id and
                hr.relationship_type == final_rel_type
                for hr in heuristic_relationships
            )
            if is_duplicate:
                 logger.debug(f"Skipping duplicate relationship {final_rel_type} from {source_global_id} to {target_global_id} (heuristic).")
                 continue

            rel_props = dict(rel.properties) if rel.properties else {}
            rel_props["analyzer"] = analyzer_name
            rel_props["original_relationship_type"] = rel.relationship_type

            final_relationships.append(neo4j_ingestion_pb2.GraphRelationship(
                source_node_global_id=source_global_id,
                target_node_global_id=target_global_id,
                relationship_type=final_rel_type,
                properties=rel_props,
                location=rel.location
            ))
            final_rel_count += 1

    logger.info(f"Pass 3 Complete: Constructed {len(final_nodes)} final nodes and {final_rel_count} final relationships. Skipped {skipped_rels_count} original relationships.")

    # Return list of nodes from the dictionary values
    return list(final_nodes.values()), final_relationships