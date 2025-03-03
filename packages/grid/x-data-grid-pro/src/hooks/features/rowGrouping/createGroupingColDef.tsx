import * as React from 'react';
import {
  GRID_STRING_COL_DEF,
  GridColDef,
  GridStateColDef,
  GridComparatorFn,
  GridRenderCellParams,
} from '@mui/x-data-grid';
import { GridColumnRawLookup } from '@mui/x-data-grid/internals';
import { GridGroupingColDefOverride } from '../../../models';
import { GridApiPro } from '../../../models/gridApiPro';
import { GridGroupingCriteriaCell } from '../../../components/GridGroupingCriteriaCell';
import { GridGroupingColumnLeafCell } from '../../../components/GridGroupingColumnLeafCell';
import {
  getRowGroupingFieldFromGroupingCriteria,
  GRID_ROW_GROUPING_SINGLE_GROUPING_FIELD,
} from './gridRowGroupingUtils';
import { gridRowGroupingSanitizedModelSelector } from './gridRowGroupingSelector';

const GROUPING_COL_DEF_DEFAULT_PROPERTIES: Omit<GridColDef, 'field'> = {
  ...GRID_STRING_COL_DEF,
  disableReorder: true,
};

const GROUPING_COL_DEF_FORCED_PROPERTIES: Pick<GridColDef, 'type' | 'editable' | 'groupable'> = {
  type: 'rowGroupByColumnsGroup',
  editable: false,
  groupable: false,
};

/**
 * When sorting two cells with different grouping criteria, we consider that the cell with the grouping criteria coming first in the model should be displayed below.
 * This can occur when some rows don't have all the fields. In which case we want the rows with the missing field to be displayed above.
 * TODO: Make this index comparator depth invariant, the logic should not be inverted when sorting in the "desc" direction (but the current return format of `sortComparator` does not support this behavior).
 */
const groupingFieldIndexComparator: GridComparatorFn = (v1, v2, cellParams1, cellParams2) => {
  const model = gridRowGroupingSanitizedModelSelector(
    cellParams1.api.state,
    cellParams1.api.instanceId,
  );
  const groupingField1 = cellParams1.rowNode.groupingField;
  const groupingField2 = cellParams2.rowNode.groupingField;

  if (groupingField1 === groupingField2) {
    return 0;
  }

  if (groupingField1 == null) {
    return -1;
  }

  if (groupingField2 == null) {
    return 1;
  }

  if (model.indexOf(groupingField1) < model.indexOf(groupingField2)) {
    return -1;
  }

  return 1;
};

const getLeafProperties = (leafColDef: GridColDef): Partial<GridColDef> => ({
  headerName: leafColDef.headerName ?? leafColDef.field,
  sortable: leafColDef.sortable,
  filterable: leafColDef.filterable,
  filterOperators: leafColDef.filterOperators?.map((operator) => ({
    ...operator,
    getApplyFilterFn: (filterItem, column) => {
      const originalFn = operator.getApplyFilterFn(filterItem, column);
      if (!originalFn) {
        return null;
      }

      return (params) => {
        // We only want to filter leaves
        if (params.rowNode.groupingField != null) {
          return true;
        }

        return originalFn(params);
      };
    },
  })),
  sortComparator: (v1, v2, cellParams1, cellParams2) => {
    // We only want to sort the leaves
    if (cellParams1.rowNode.groupingField === null && cellParams2.rowNode.groupingField === null) {
      return leafColDef.sortComparator!(v1, v2, cellParams1, cellParams2);
    }

    return groupingFieldIndexComparator(v1, v2, cellParams1, cellParams2);
  },
});

const getGroupingCriteriaProperties = (
  groupedByColDef: GridColDef | GridStateColDef,
  applyHeaderName: boolean,
) => {
  const properties: Partial<GridColDef> = {
    sortable: groupedByColDef.sortable,
    filterable: groupedByColDef.filterable,
    sortComparator: (v1, v2, cellParams1, cellParams2) => {
      // We only want to sort the groups of the current grouping criteria
      if (
        cellParams1.rowNode.groupingField === groupedByColDef.field &&
        cellParams2.rowNode.groupingField === groupedByColDef.field
      ) {
        return groupedByColDef.sortComparator!(v1, v2, cellParams1, cellParams2);
      }

      return groupingFieldIndexComparator(v1, v2, cellParams1, cellParams2);
    },
    filterOperators: groupedByColDef.filterOperators?.map((operator) => ({
      ...operator,
      getApplyFilterFn: (filterItem, column) => {
        const originalFn = operator.getApplyFilterFn(filterItem, column);
        if (!originalFn) {
          return null;
        }

        return (params) => {
          // We only want to filter the groups of the current grouping criteria
          if (params.rowNode.groupingField !== groupedByColDef.field) {
            return true;
          }

          return originalFn(params);
        };
      },
    })),
  };

  if (applyHeaderName) {
    properties.headerName = groupedByColDef.headerName ?? groupedByColDef.field;
  }

  return properties;
};

interface CreateGroupingColDefMonoCriteriaParams {
  columnsLookup: GridColumnRawLookup;
  /**
   * The field from which we are grouping the rows.
   */
  groupingCriteria: string;
  /**
   * The col def from which we are grouping the rows.
   */
  groupedByColDef: GridColDef | GridStateColDef;
  /**
   * The col def properties the user wants to override.
   * This value comes `prop.groupingColDef`.
   */
  colDefOverride: GridGroupingColDefOverride | null | undefined;
}

/**
 * Creates the `GridColDef` for a grouping column that only takes care of a single grouping criteria
 */
export const createGroupingColDefForOneGroupingCriteria = ({
  columnsLookup,
  groupedByColDef,
  groupingCriteria,
  colDefOverride,
}: CreateGroupingColDefMonoCriteriaParams): GridColDef => {
  const { leafField, mainGroupingCriteria, hideDescendantCount, ...colDefOverrideProperties } =
    colDefOverride ?? {};
  const leafColDef = leafField ? columnsLookup[leafField] : null;

  // The properties that do not depend on the presence of a `leafColDef` and that can be overridden by `colDefOverride`
  const commonProperties: Partial<GridColDef> = {
    width: Math.max(
      (groupedByColDef.width ?? GRID_STRING_COL_DEF.width!) + 40,
      leafColDef?.width ?? 0,
    ),
    renderCell: (params) => {
      // Render leaves
      if (params.rowNode.groupingField == null) {
        if (leafColDef) {
          const leafParams: GridRenderCellParams = {
            ...params.api.getCellParams(params.id, leafField!),
            api: params.api,
          };
          if (leafColDef.renderCell) {
            return leafColDef.renderCell(leafParams);
          }

          return <GridGroupingColumnLeafCell {...leafParams} />;
        }

        return '';
      }

      // Render current grouping criteria groups
      if (params.rowNode.groupingField === groupingCriteria) {
        return <GridGroupingCriteriaCell {...params} hideDescendantCount={hideDescendantCount} />;
      }

      return '';
    },
    valueGetter: (params) => {
      if (!params.rowNode) {
        return undefined;
      }

      if (params.rowNode.groupingField == null) {
        if (leafColDef) {
          return params.api.getCellValue(params.id, leafField!);
        }

        return undefined;
      }

      if (params.rowNode.groupingField === groupingCriteria) {
        return params.rowNode.groupingKey;
      }

      return undefined;
    },
  };

  // If we have a `mainGroupingCriteria` defined and matching the `groupingCriteria`
  // Then we apply the sorting / filtering on the groups of this column's grouping criteria based on the properties of `groupedByColDef`.
  // It can be useful to define a `leafField` for leaves rendering but still use the grouping criteria for the sorting / filtering
  //
  // If we have a `leafField` defined and matching an existing column
  // Then we apply the sorting / filtering on the leaves based on the properties of `leavesColDef`
  //
  // By default, we apply the sorting / filtering on the groups of this column's grouping criteria based on the properties of `groupedColDef`.
  let sourceProperties: Partial<GridColDef>;
  if (mainGroupingCriteria && mainGroupingCriteria === groupingCriteria) {
    sourceProperties = getGroupingCriteriaProperties(groupedByColDef, true);
  } else if (leafColDef) {
    sourceProperties = getLeafProperties(leafColDef);
  } else {
    sourceProperties = getGroupingCriteriaProperties(groupedByColDef, true);
  }

  // The properties that can't be overridden with `colDefOverride`
  const forcedProperties: Pick<GridColDef, 'field' | 'editable'> = {
    field: getRowGroupingFieldFromGroupingCriteria(groupingCriteria),
    ...GROUPING_COL_DEF_FORCED_PROPERTIES,
  };

  return {
    ...GROUPING_COL_DEF_DEFAULT_PROPERTIES,
    ...commonProperties,
    ...sourceProperties,
    ...colDefOverrideProperties,
    ...forcedProperties,
  };
};

interface CreateGroupingColDefSeveralCriteriaParams {
  apiRef: React.MutableRefObject<GridApiPro>;
  columnsLookup: GridColumnRawLookup;

  /**
   * The fields from which we are grouping the rows.
   */
  rowGroupingModel: string[];

  /**
   * The col def properties the user wants to override.
   * This value comes `prop.groupingColDef`.
   */
  colDefOverride: GridGroupingColDefOverride | null | undefined;
}

/**
 * Creates the `GridColDef` for a grouping column that takes care of all the grouping criteria
 */
export const createGroupingColDefForAllGroupingCriteria = ({
  apiRef,
  columnsLookup,
  rowGroupingModel,
  colDefOverride,
}: CreateGroupingColDefSeveralCriteriaParams): GridColDef => {
  const { leafField, mainGroupingCriteria, hideDescendantCount, ...colDefOverrideProperties } =
    colDefOverride ?? {};
  const leafColDef = leafField ? columnsLookup[leafField] : null;

  // The properties that do not depend on the presence of a `leafColDef` and that can be overridden by `colDefOverride`
  const commonProperties: Partial<GridColDef> = {
    headerName: apiRef.current.getLocaleText('groupingColumnHeaderName'),
    width: Math.max(
      ...rowGroupingModel.map(
        (field) => (columnsLookup[field].width ?? GRID_STRING_COL_DEF.width!) + 40,
      ),
      leafColDef?.width ?? 0,
    ),
    renderCell: (params) => {
      // Render the leaves
      if (params.rowNode.groupingField == null) {
        if (leafColDef) {
          const leafParams: GridRenderCellParams = {
            ...params.api.getCellParams(params.id, leafField!),
            api: params.api,
          };
          if (leafColDef.renderCell) {
            return leafColDef.renderCell(leafParams);
          }

          return <GridGroupingColumnLeafCell {...leafParams} />;
        }

        return '';
      }

      // Render the groups
      return <GridGroupingCriteriaCell {...params} hideDescendantCount={hideDescendantCount} />;
    },
    valueGetter: (params) => {
      if (!params.rowNode) {
        return undefined;
      }

      if (params.rowNode.groupingField == null) {
        if (leafColDef) {
          return params.api.getCellValue(params.id, leafField!);
        }

        return undefined;
      }

      return params.rowNode.groupingKey;
    },
  };

  // If we have a `mainGroupingCriteria` defined and matching one of the `orderedGroupedByFields`
  // Then we apply the sorting / filtering on the groups of this column's grouping criteria based on the properties of `columnsLookup[mainGroupingCriteria]`.
  // It can be useful to use another grouping criteria than the top level one for the sorting / filtering
  //
  // If we have a `leafField` defined and matching an existing column
  // Then we apply the sorting / filtering on the leaves based on the properties of `leavesColDef`
  //
  // By default, we apply the sorting / filtering on the groups of the top level grouping criteria based on the properties of `columnsLookup[orderedGroupedByFields[0]]`.
  let sourceProperties: Partial<GridColDef>;
  if (mainGroupingCriteria && rowGroupingModel.includes(mainGroupingCriteria)) {
    sourceProperties = getGroupingCriteriaProperties(columnsLookup[mainGroupingCriteria], true);
  } else if (leafColDef) {
    sourceProperties = getLeafProperties(leafColDef);
  } else {
    sourceProperties = getGroupingCriteriaProperties(
      columnsLookup[rowGroupingModel[0]],
      rowGroupingModel.length === 1,
    );
  }

  // The properties that can't be overridden with `colDefOverride`
  const forcedProperties: Pick<GridColDef, 'field' | 'editable'> = {
    field: GRID_ROW_GROUPING_SINGLE_GROUPING_FIELD,
    ...GROUPING_COL_DEF_FORCED_PROPERTIES,
  };

  return {
    ...GROUPING_COL_DEF_DEFAULT_PROPERTIES,
    ...commonProperties,
    ...sourceProperties,
    ...colDefOverrideProperties,
    ...forcedProperties,
  };
};
