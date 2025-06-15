import { DynamoDB } from 'aws-sdk';
import { verify } from 'jsonwebtoken';

// Cliente DynamoDB
const dynamodb = new DynamoDB.DocumentClient();
const tableName = process.env.TABLE_NAME;
const jwtSecret = process.env.JWT_SECRET;

// Función helper para respuestas consistentes
const lambdaResponse = (statusCode, body) => {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify(body)
    };
};

// Función para validar token JWT
const validarToken = (event) => {
    try {
        let token = null;
        
        // Buscar token en headers Authorization
        if (event.headers && event.headers.Authorization) {
            const authHeader = event.headers.Authorization;
            if (authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            }
        }
        
        // Buscar token en headers authorization (minúscula)
        if (!token && event.headers && event.headers.authorization) {
            const authHeader = event.headers.authorization;
            if (authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            }
        }
        
        if (!token) {
            return { valid: false, error: 'Token requerido' };
        }
        
        const payload = verify(token, jwtSecret);
        return { valid: true, usuario: payload };
        
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return { valid: false, error: 'Token expirado' };
        } else if (error.name === 'JsonWebTokenError') {
            return { valid: false, error: 'Token inválido' };
        }
        return { valid: false, error: 'Error validando token' };
    }
};

// Función para generar código único de producto
const generarCodigoProducto = () => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `MED-${timestamp}-${random}`.toUpperCase();
};

// Listar productos con paginación
export async function listarProductos(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        const queryParams = event.queryStringParameters || {};
        const limit = parseInt(queryParams.limit) || 20;
        let lastEvaluatedKey = null;
        
        if (queryParams.lastKey) {
            try {
                lastEvaluatedKey = JSON.parse(Buffer.from(queryParams.lastKey, 'base64').toString());
            } catch (e) {
                return lambdaResponse(400, { error: 'lastKey inválido' });
            }
        }
        
        const params = {
            TableName: tableName,
            KeyConditionExpression: 'tenant_id = :tenant_id',
            ExpressionAttributeValues: {
                ':tenant_id': tenantId
            },
            Limit: limit,
            ScanIndexForward: false // Ordenar por fecha de creación descendente
        };
        
        if (lastEvaluatedKey) {
            params.ExclusiveStartKey = lastEvaluatedKey;
        }
        
        const result = await dynamodb.query(params).promise();
        
        let nextKey = null;
        if (result.LastEvaluatedKey) {
            nextKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
        }
        
        return lambdaResponse(200, {
            productos: result.Items,
            count: result.Items.length,
            nextKey: nextKey,
            hasMore: !!result.LastEvaluatedKey
        });
        
    } catch (error) {
        console.error('Error listando productos:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Crear producto
export async function crearProducto(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            return lambdaResponse(400, { error: 'JSON inválido' });
        }
        
        // Validar campos requeridos
        const requiredFields = ['nombre', 'precio', 'descripcion'];
        for (const field of requiredFields) {
            if (!body[field]) {
                return lambdaResponse(400, { error: `Campo requerido: ${field}` });
            }
        }
        
        // Validar precio
        const precio = parseFloat(body.precio);
        if (isNaN(precio) || precio <= 0) {
            return lambdaResponse(400, { error: 'Precio debe ser un número mayor a 0' });
        }
        
        const codigo = generarCodigoProducto();
        const fechaCreacion = new Date().toISOString();
        
        const producto = {
            tenant_id: tenantId,
            codigo: codigo,
            nombre: body.nombre.trim(),
            precio: precio,
            descripcion: body.descripcion.trim(),
            imagen_url: body.imagen_url || '',
            fecha_creacion: fechaCreacion,
            fecha_modificacion: fechaCreacion,
            activo: true
        };
        
        const params = {
            TableName: tableName,
            Item: producto
        };
        
        await dynamodb.put(params).promise();
        
        return lambdaResponse(201, {
            message: 'Producto creado exitosamente',
            producto: producto
        });
        
    } catch (error) {
        console.error('Error creando producto:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Buscar producto por código
export async function buscarProducto(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        const codigo = event.pathParameters?.codigo;
        
        if (!codigo) {
            return lambdaResponse(400, { error: 'Código de producto requerido' });
        }
        
        const params = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            }
        };
        
        const result = await dynamodb.get(params).promise();
        
        if (!result.Item) {
            return lambdaResponse(404, { error: 'Producto no encontrado' });
        }
        
        return lambdaResponse(200, {
            producto: result.Item
        });
        
    } catch (error) {
        console.error('Error buscando producto:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Modificar producto
export async function modificarProducto(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        const codigo = event.pathParameters?.codigo;
        
        if (!codigo) {
            return lambdaResponse(400, { error: 'Código de producto requerido' });
        }
        
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            return lambdaResponse(400, { error: 'JSON inválido' });
        }
        
        // Verificar que el producto existe
        const getParams = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            }
        };
        
        const existingProduct = await dynamodb.get(getParams).promise();
        if (!existingProduct.Item) {
            return lambdaResponse(404, { error: 'Producto no encontrado' });
        }
        
        // Construir expresión de actualización
        let updateExpression = 'SET fecha_modificacion = :fecha_modificacion';
        let expressionAttributeValues = {
            ':fecha_modificacion': new Date().toISOString()
        };
        let expressionAttributeNames = {};
        
        // Campos que se pueden actualizar
        const updatableFields = ['nombre', 'precio', 'descripcion', 'imagen_url', 'activo'];
        
        for (const field of updatableFields) {
            if (body[field] !== undefined) {
                if (field === 'precio') {
                    const precio = parseFloat(body[field]);
                    if (isNaN(precio) || precio <= 0) {
                        return lambdaResponse(400, { error: 'Precio debe ser un número mayor a 0' });
                    }
                    updateExpression += `, #${field} = :${field}`;
                    expressionAttributeNames[`#${field}`] = field;
                    expressionAttributeValues[`:${field}`] = precio;
                } else if (field === 'nombre' || field === 'descripcion') {
                    if (typeof body[field] !== 'string' || !body[field].trim()) {
                        return lambdaResponse(400, { error: `${field} no puede estar vacío` });
                    }
                    updateExpression += `, #${field} = :${field}`;
                    expressionAttributeNames[`#${field}`] = field;
                    expressionAttributeValues[`:${field}`] = body[field].trim();
                } else {
                    updateExpression += `, #${field} = :${field}`;
                    expressionAttributeNames[`#${field}`] = field;
                    expressionAttributeValues[`:${field}`] = body[field];
                }
            }
        }
        
        const updateParams = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ExpressionAttributeNames: expressionAttributeNames,
            ReturnValues: 'ALL_NEW'
        };
        
        const result = await dynamodb.update(updateParams).promise();
        
        return lambdaResponse(200, {
            message: 'Producto modificado exitosamente',
            producto: result.Attributes
        });
        
    } catch (error) {
        console.error('Error modificando producto:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Eliminar producto
export async function eliminarProducto(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        const codigo = event.pathParameters?.codigo;
        
        if (!codigo) {
            return lambdaResponse(400, { error: 'Código de producto requerido' });
        }
        
        // Verificar que el producto existe antes de eliminar
        const getParams = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            }
        };
        
        const existingProduct = await dynamodb.get(getParams).promise();
        if (!existingProduct.Item) {
            return lambdaResponse(404, { error: 'Producto no encontrado' });
        }
        
        const deleteParams = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            },
            ReturnValues: 'ALL_OLD'
        };
        
        const result = await dynamodb.delete(deleteParams).promise();
        
        return lambdaResponse(200, {
            message: 'Producto eliminado exitosamente',
            producto_eliminado: result.Attributes
        });
        
    } catch (error) {
        console.error('Error eliminando producto:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}