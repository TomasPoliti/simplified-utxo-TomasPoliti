import { Transaction, TransactionInput } from './types';
import { UTXOPoolManager } from './utxo-pool';
import { verify } from './utils/crypto';
import {
  ValidationResult,
  ValidationError,
  VALIDATION_ERRORS,
  createValidationError
} from './errors';

export class TransactionValidator {
  constructor(private utxoPool: UTXOPoolManager) {}

  /**
   * Validate a transaction
   * @param {Transaction} transaction - The transaction to validate
   * @returns {ValidationResult} The validation result
   */
  validateTransaction(transaction: Transaction): ValidationResult {
    const errors: ValidationError[] = [];

    const tempPool = this.utxoPool.clone();

    const txData = this.createTransactionDataForSigning_(transaction);
    let totalInputs = 0;
    let totalOutputs = 0;

    for (const input of transaction.inputs) {
      const { txId, outputIndex } = input.utxoId;

      // 1) Verificamos existencia en el pool real
      const utxo = this.utxoPool.getUTXO(txId, outputIndex);
      if (!utxo) {
        errors.push(createValidationError(
            VALIDATION_ERRORS.UTXO_NOT_FOUND,
            `UTXO no encontrado: ${txId}:${outputIndex}`
        ));
        continue;
      }

      // 2) Simulamos el gasto en el pool clonado
      const removed = tempPool.removeUTXO(txId, outputIndex);
      if (!removed) {
        errors.push(createValidationError(
            VALIDATION_ERRORS.DOUBLE_SPENDING,
            `UTXO referenciado más de una vez: ${txId}:${outputIndex}`
        ));
      }

      // 3) Monto positivo del input
      if (!Number.isFinite(utxo.amount) || utxo.amount <= 0) {
        errors.push(createValidationError(
            VALIDATION_ERRORS.NEGATIVE_AMOUNT,
            `UTXO con monto no positivo: ${utxo.amount} en ${txId}:${outputIndex}`
        ));
      } else {
        totalInputs += utxo.amount;
      }

      // 4) Firma válida del dueño del UTXO
      const okSig = verify(txData, input.signature, utxo.recipient);
      if (!okSig) {
        errors.push(createValidationError(
            VALIDATION_ERRORS.INVALID_SIGNATURE,
            `Firma inválida para UTXO ${txId}:${outputIndex}`
        ));
      }
    }

    for (const out of transaction.outputs) {
      if (!Number.isFinite(out.amount) || out.amount <= 0) {
        errors.push(createValidationError(
            VALIDATION_ERRORS.NEGATIVE_AMOUNT,
            `Output con monto no positivo: ${out.amount} para ${out.recipient}`
        ));
      } else {
        totalOutputs += out.amount;
      }
    }
    
    if (totalInputs !== totalOutputs) {
      errors.push(createValidationError(
          VALIDATION_ERRORS.AMOUNT_MISMATCH,
          `Suma entradas=${totalInputs} distinta a salidas=${totalOutputs}`
      ));
    }

    return { valid: errors.length === 0, errors };
  }

  
  /**
   * Create a deterministic string representation of the transaction for signing
   * This excludes the signatures to prevent circular dependencies
   * @param {Transaction} transaction - The transaction to create a data for signing
   * @returns {string} The string representation of the transaction for signing
   */
  private createTransactionDataForSigning_(transaction: Transaction): string {
    const unsignedTx = {
      id: transaction.id,
      inputs: transaction.inputs.map(input => ({
        utxoId: input.utxoId,
        owner: input.owner
      })),
      outputs: transaction.outputs,
      timestamp: transaction.timestamp
    };

    return JSON.stringify(unsignedTx);
  }
}
