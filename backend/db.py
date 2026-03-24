import mysql.connector

from config import load_mysql_config


def get_connection():
    mysql_config = load_mysql_config()
    return mysql.connector.connect(
        host=mysql_config["MYSQL_HOST"],
        port=mysql_config["MYSQL_PORT"],
        user=mysql_config["MYSQL_USER"],
        password=mysql_config["MYSQL_PASSWORD"],
        database=mysql_config["MYSQL_DB"],
        connection_timeout=mysql_config["MYSQL_CONNECT_TIMEOUT"],
    )
