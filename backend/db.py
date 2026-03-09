import os

import mysql.connector


def get_connection():
    return mysql.connector.connect(
        host=os.getenv("MYSQL_HOST", "localhost"),
        user=os.getenv("MYSQL_USER", "root"),
        password=os.getenv("MYSQL_PASSWORD", "Sankalp268@"),
        database=os.getenv("MYSQL_DB", "ev_charging_system"),
    )
