import json
import os
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])


def handler(event, context):
    http_method = event.get('httpMethod', 'GET')

    if http_method == 'OPTIONS':
        return _cors_preflight()

    if http_method != 'GET':
        return _response(405, {'error': 'Method not allowed'})

    try:
        result = table.update_item(
            Key={'pk': 'visitor_count'},
            UpdateExpression='ADD visit_count :inc',
            ExpressionAttributeValues={':inc': 1},
            ReturnValues='UPDATED_NEW'
        )
        count = int(result['Attributes']['visit_count'])
        return _response(200, {'count': count})
    except ClientError as e:
        print(f"DynamoDB error: {e.response['Error']['Message']}")
        return _response(500, {'error': 'Failed to update visitor count'})


def _response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
        'body': json.dumps(body),
    }


def _cors_preflight():
    return {
        'statusCode': 204,
        'headers': {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
        'body': '',
    }
