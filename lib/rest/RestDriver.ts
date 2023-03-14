import Int64 from 'node-int64';

import {
  TCancelDelegationTokenReq,
  TCancelDelegationTokenResp,
  TCancelOperationReq,
  TCancelOperationResp,
  TCloseOperationReq,
  TCloseOperationResp,
  TCloseSessionReq,
  TCloseSessionResp,
  TColumn,
  TColumnDesc,
  TExecuteStatementReq,
  TExecuteStatementResp,
  TFetchResultsReq,
  TFetchResultsResp,
  TGetCatalogsReq,
  TGetCatalogsResp,
  TGetColumnsReq,
  TGetColumnsResp,
  TGetCrossReferenceReq,
  TGetCrossReferenceResp,
  TGetDelegationTokenReq,
  TGetDelegationTokenResp,
  TGetFunctionsReq,
  TGetFunctionsResp,
  TGetInfoReq,
  TGetInfoResp,
  TGetOperationStatusReq,
  TGetOperationStatusResp,
  TGetPrimaryKeysReq,
  TGetPrimaryKeysResp,
  TGetResultSetMetadataReq,
  TGetResultSetMetadataResp,
  TGetSchemasReq,
  TGetSchemasResp,
  TGetTablesReq,
  TGetTablesResp,
  TGetTableTypesReq,
  TGetTableTypesResp,
  TGetTypeInfoReq,
  TGetTypeInfoResp,
  THandleIdentifier,
  TOpenSessionReq,
  TOpenSessionResp,
  TOperationHandle,
  TOperationState,
  TOperationType,
  TProtocolVersion,
  TRenewDelegationTokenReq,
  TRenewDelegationTokenResp,
  TRowSet,
  TSessionHandle,
  TSparkRowSetType,
  TStatus,
  TStatusCode,
  TTypeId,
} from '../../thrift/TCLIService_types';

import RestClient from './RestClient';
import {
  ColumnInfoTypeName,
  Disposition,
  ExecuteStatementResponse,
  Format,
  ResultData,
  ResultSchema,
  StatementState,
  StatementStatus,
  TimeoutAction,
} from './Types';

class NotImplementedError extends Error {
  constructor() {
    super('RestDriver: Method not implemented');
  }
}

function restOperationStateToThriftOperationState(state: StatementState): TOperationState {
  switch (state) {
    case StatementState.Canceled:
      return TOperationState.CANCELED_STATE;
    case StatementState.Closed:
      return TOperationState.CLOSED_STATE;
    case StatementState.Failed:
      return TOperationState.ERROR_STATE;
    case StatementState.Pending:
      return TOperationState.PENDING_STATE;
    case StatementState.Running:
      return TOperationState.RUNNING_STATE;
    case StatementState.Succeeded:
      return TOperationState.FINISHED_STATE;
    default:
      return TOperationState.UKNOWN_STATE;
  }
}

function restTypeNameToThriftTypeId(typeName: ColumnInfoTypeName): TTypeId {
  switch (typeName) {
    case ColumnInfoTypeName.Array:
      return TTypeId.ARRAY_TYPE;
    case ColumnInfoTypeName.Binary:
      return TTypeId.BINARY_TYPE;
    case ColumnInfoTypeName.Boolean:
      return TTypeId.BOOLEAN_TYPE;
    case ColumnInfoTypeName.Byte:
      return TTypeId.TINYINT_TYPE; // ??
    case ColumnInfoTypeName.Char:
      return TTypeId.CHAR_TYPE;
    case ColumnInfoTypeName.Date:
      return TTypeId.DATE_TYPE;
    case ColumnInfoTypeName.Decimal:
      return TTypeId.DECIMAL_TYPE;
    case ColumnInfoTypeName.Double:
      return TTypeId.DOUBLE_TYPE;
    case ColumnInfoTypeName.Float:
      return TTypeId.FLOAT_TYPE;
    case ColumnInfoTypeName.Int:
      return TTypeId.INT_TYPE;
    case ColumnInfoTypeName.Interval:
      return TTypeId.INTERVAL_DAY_TIME_TYPE; // ??
    case ColumnInfoTypeName.Long:
      return TTypeId.INT_TYPE; // ??
    case ColumnInfoTypeName.Map:
      return TTypeId.MAP_TYPE;
    case ColumnInfoTypeName.Null:
      return TTypeId.NULL_TYPE;
    case ColumnInfoTypeName.Short:
      return TTypeId.SMALLINT_TYPE; // ??
    case ColumnInfoTypeName.String:
      return TTypeId.STRING_TYPE;
    case ColumnInfoTypeName.Struct:
      return TTypeId.STRUCT_TYPE;
    case ColumnInfoTypeName.Timestamp:
      return TTypeId.TIMESTAMP_TYPE;
    case ColumnInfoTypeName.UserDefinedType:
      return TTypeId.USER_DEFINED_TYPE;
    default:
      return TTypeId.NULL_TYPE; // ??
  }
}

function restJsonResultToThriftColumnar(schema: ResultSchema, result: ResultData): TRowSet {
  const columns: TColumn[] = schema.columns.map(() => ({
    stringVal: { values: [], nulls: Buffer.alloc(0) },
  }));

  if (result.data_array) {
    result.data_array.forEach((row) => {
      for (let i = 0; i < row.length; i++) {
        columns[i].stringVal?.values.push(row[i]);
      }
    });
  }

  return {
    startRowOffset: new Int64(0),
    rows: [],
    columns,
    columnCount: columns.length,
  };
}

export default class RestDriver {
  private client: RestClient;

  // REST API doesn't support sessions; we emulate it, but only single session is supported in this PoC
  private session?: TOpenSessionReq = undefined;

  // In this PoC we don't support concurrent queries, so just store currently processed query id to simplify things
  private currentStatement?: ExecuteStatementResponse = undefined;
  private currentResultChunk?: ResultData = undefined;

  constructor(client: RestClient) {
    this.client = client;
  }

  private processStatementStatus(status: StatementStatus) {
    switch (status.state) {
      case StatementState.Canceled:
      case StatementState.Closed:
        this.currentStatement = undefined;
        return;
      case StatementState.Failed:
        throw new Error(`${status.error.error_code}: ${status.error.message}`);
      default:
        return;
    }
  }

  async openSession(request: TOpenSessionReq): Promise<TOpenSessionResp> {
    this.session = request;
    return new TOpenSessionResp({
      status: new TStatus({ statusCode: TStatusCode.SUCCESS_STATUS }),
      serverProtocolVersion: request.client_protocol || TProtocolVersion.SPARK_CLI_SERVICE_PROTOCOL_V6,
      sessionHandle: new TSessionHandle({
        sessionId: new THandleIdentifier({
          guid: Buffer.alloc(16),
          secret: Buffer.alloc(0),
        }),
      }),
    });
  }

  async closeSession(request: TCloseSessionReq): Promise<TCloseSessionResp> {
    this.session = undefined;
    return new TCloseSessionResp({
      status: new TStatus({ statusCode: TStatusCode.SUCCESS_STATUS }),
    });
  }

  async executeStatement(request: TExecuteStatementReq): Promise<TExecuteStatementResp> {
    this.currentStatement = await this.client.executeStatement({
      catalog: this.session?.initialNamespace?.catalogName,
      schema: this.session?.initialNamespace?.schemaName,
      disposition: Disposition.Inline,
      format: Format.JsonArray,
      on_wait_timeout: TimeoutAction.Continue,
      wait_timeout: '5s',
      warehouse_id: this.client.getWarehouseId(),
      statement: request.statement,
    });

    this.processStatementStatus(this.currentStatement.status);

    if (!this.currentStatement) {
      return new TExecuteStatementResp({
        status: new TStatus({ statusCode: TStatusCode.INVALID_HANDLE_STATUS }),
      });
    }

    return new TExecuteStatementResp({
      status: new TStatus({ statusCode: TStatusCode.SUCCESS_STATUS }),
      operationHandle: new TOperationHandle({
        operationId: new THandleIdentifier({
          guid: Buffer.alloc(16),
          secret: Buffer.alloc(0),
        }),
        operationType: TOperationType.EXECUTE_STATEMENT,
        hasResultSet: this.currentStatement?.result?.chunk_index !== undefined,
      }),
    });
  }

  async getResultSetMetadata(request: TGetResultSetMetadataReq): Promise<TGetResultSetMetadataResp> {
    if (!this.currentStatement) {
      return new TGetResultSetMetadataResp({
        status: new TStatus({ statusCode: TStatusCode.ERROR_STATUS, errorMessage: 'Invalid handle' }),
      });
    }

    const columns: TColumnDesc[] = [];
    this.currentStatement.manifest?.schema?.columns?.forEach((column) => {
      columns.push({
        columnName: column.name,
        position: column.position + 1, // thrift columns are 1-based, rest columns are 0-based
        typeDesc: {
          types: [
            {
              primitiveEntry: {
                type: restTypeNameToThriftTypeId(column.type_name),
              },
            },
          ],
        },
      });
    });

    return new TGetResultSetMetadataResp({
      status: new TStatus({ statusCode: TStatusCode.SUCCESS_STATUS }),
      resultFormat: TSparkRowSetType.COLUMN_BASED_SET,
      schema: { columns },
    });
  }

  async fetchResults(request: TFetchResultsReq): Promise<TFetchResultsResp> {
    if (!this.currentStatement) {
      return new TFetchResultsResp({
        status: new TStatus({ statusCode: TStatusCode.ERROR_STATUS, errorMessage: 'Invalid handle' }),
      });
    }

    if (!this.currentResultChunk) {
      this.currentResultChunk = this.currentStatement.result;
    } else {
      this.currentResultChunk = await this.client.getStatementResultChunkN({
        statement_id: this.currentStatement.statement_id,
        chunk_index: this.currentResultChunk.next_chunk_index,
      });
    }

    if (!this.currentResultChunk) {
      return new TFetchResultsResp({
        status: new TStatus({ statusCode: TStatusCode.ERROR_STATUS, errorMessage: 'No more data' }),
      });
    }

    const schema = this.currentStatement.manifest?.schema || {
      column_count: 0,
      columns: [],
    };

    return new TFetchResultsResp({
      status: new TStatus({ statusCode: TStatusCode.SUCCESS_STATUS }),
      hasMoreRows: this.currentResultChunk?.next_chunk_index !== undefined,
      results: restJsonResultToThriftColumnar(schema, this.currentResultChunk),
    });
  }

  async getInfo(request: TGetInfoReq): Promise<TGetInfoResp> {
    throw new NotImplementedError();
  }

  async getTypeInfo(request: TGetTypeInfoReq): Promise<TGetTypeInfoResp> {
    throw new NotImplementedError();
  }

  async getCatalogs(request: TGetCatalogsReq): Promise<TGetCatalogsResp> {
    throw new NotImplementedError();
  }

  async getSchemas(request: TGetSchemasReq): Promise<TGetSchemasResp> {
    throw new NotImplementedError();
  }

  async getTables(request: TGetTablesReq): Promise<TGetTablesResp> {
    throw new NotImplementedError();
  }

  async getTableTypes(request: TGetTableTypesReq): Promise<TGetTableTypesResp> {
    throw new NotImplementedError();
  }

  async getColumns(request: TGetColumnsReq): Promise<TGetColumnsResp> {
    throw new NotImplementedError();
  }

  async getFunctions(request: TGetFunctionsReq): Promise<TGetFunctionsResp> {
    throw new NotImplementedError();
  }

  async getPrimaryKeys(request: TGetPrimaryKeysReq): Promise<TGetPrimaryKeysResp> {
    throw new NotImplementedError();
  }

  async getCrossReference(request: TGetCrossReferenceReq): Promise<TGetCrossReferenceResp> {
    throw new NotImplementedError();
  }

  async getOperationStatus(request: TGetOperationStatusReq): Promise<TGetOperationStatusResp> {
    if (this.currentStatement && !this.currentStatement.manifest) {
      const response = await this.client.getStatement({ statement_id: this.currentStatement.statement_id });
      this.currentStatement.status = response.status;
      this.currentStatement.manifest = response.manifest;
      this.currentStatement.result = response.result;

      console.log(JSON.stringify(response, null, 2));

      this.processStatementStatus(this.currentStatement.status);
    }

    if (!this.currentStatement) {
      return new TGetOperationStatusResp({
        status: new TStatus({ statusCode: TStatusCode.ERROR_STATUS, errorMessage: 'Invalid handle' }),
      });
    }

    return new TGetOperationStatusResp({
      status: new TStatus({ statusCode: TStatusCode.SUCCESS_STATUS }),
      operationState: restOperationStateToThriftOperationState(this.currentStatement.status.state),
      errorCode: 0,
      errorMessage: `${this.currentStatement.status.error?.error_code}: ${this.currentStatement.status.error?.message}`,
      hasResultSet: Boolean(this.currentStatement.result),
    });
  }

  async cancelOperation(request: TCancelOperationReq): Promise<TCancelOperationResp> {
    if (this.currentStatement) {
      await this.client.cancelExecution({
        statement_id: this.currentStatement.statement_id,
      });
      this.currentStatement = undefined;
    }
    return new TCancelOperationResp({
      status: new TStatus({ statusCode: TStatusCode.SUCCESS_STATUS }),
    });
  }

  async closeOperation(request: TCloseOperationReq): Promise<TCloseOperationResp> {
    this.currentStatement = undefined;
    return new TCloseOperationResp({
      status: new TStatus({ statusCode: TStatusCode.SUCCESS_STATUS }),
    });
  }

  async getDelegationToken(request: TGetDelegationTokenReq): Promise<TGetDelegationTokenResp> {
    throw new NotImplementedError();
  }

  async cancelDelegationToken(request: TCancelDelegationTokenReq): Promise<TCancelDelegationTokenResp> {
    throw new NotImplementedError();
  }

  async renewDelegationToken(request: TRenewDelegationTokenReq): Promise<TRenewDelegationTokenResp> {
    throw new NotImplementedError();
  }
}