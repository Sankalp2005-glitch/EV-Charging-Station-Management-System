def is_unknown_column_error(error):
    return bool(getattr(error, "args", None)) and error.args[0] == 1054


def is_missing_table_error(error):
    return bool(getattr(error, "args", None)) and error.args[0] == 1146


def is_retryable_transaction_error(error):
    return bool(getattr(error, 'args', None)) and error.args[0] in {1205, 1213}
