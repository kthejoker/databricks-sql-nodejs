import { TOperationHandle, TCloseOperationResp } from '../../thrift/TCLIService_types';
import HiveDriver from '../hive/HiveDriver';
import Status from '../dto/Status';

export default class CompleteOperationHelper {
  private readonly driver: HiveDriver;

  private readonly operationHandle: TOperationHandle;

  public closed: boolean = false;

  public cancelled: boolean = false;

  constructor(driver: HiveDriver, operationHandle: TOperationHandle, closeOperation?: TCloseOperationResp) {
    this.driver = driver;
    this.operationHandle = operationHandle;

    if (closeOperation) {
      Status.assert(closeOperation.status);
      this.closed = true;
    }
  }

  public async cancel(): Promise<Status> {
    if (this.cancelled) {
      return Status.success();
    }

    const response = await this.driver.cancelOperation({
      operationHandle: this.operationHandle,
    });
    Status.assert(response.status);
    this.cancelled = true;
    return new Status(response.status);
  }

  public async close(): Promise<Status> {
    if (this.closed) {
      return Status.success();
    }

    const response = await this.driver.closeOperation({
      operationHandle: this.operationHandle,
    });
    Status.assert(response.status);
    this.closed = true;
    return new Status(response.status);
  }
}
