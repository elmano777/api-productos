import { DynamoDB } from 'aws-sdk';
import { verify } from 'jsonwebtoken';

// Cliente DynamoDB
const dynamodb = new DynamoDB.DocumentClient();
const tableName = process.env.TABLE_NAME;
const jwtSecret = process.env.JWT_SECRET;

/**
 * Función helper para respuestas consistentes
 */
const lambdaResponse = (statusCode, body) => {
    return {
        statusCode: statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify(body)
    };
};

/**
 * Función para validar token JWT
 */
const validarToken = (authHeader) => {
    try {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error('Token no proporcionado');
        }
        
        const token = authHeader.split(' ')[1];
        const payload = verify(token, jwtSecret);
        return payload;
    } catch (error) {
        throw new Error('Token inválido o expirado');
    }
};

/**
 * Función para generar código único de producto
 */
const generarCodigoProducto = () => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `MED-${timestamp}-${random}`.toUpperCase();
};

/**
 * LISTAR PRODUCTOS (con paginación)
 */
export async function listarProductos(event, context) {
    try {
        // Validar token
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const usuario = validarToken(authHeader);
        
        const tenantId = usuario.tenant_id;
        const limit = parseInt(event.queryStringParameters?.limit) || 10;
        const lastEvaluatedKey = event.queryStringParameters?.lastKey ? 
            JSON.parse(decodeURIComponent(event.queryStringParameters.lastKey)) : undefined;
        
        const params = {
            TableName: tableName,
            IndexName: 'tenant_id-index',
            KeyConditionExpression: 'tenant_id = :tenant_id',
            ExpressionAttributeValues: {
                ':tenant_id': tenantId,
                ':activo': true
            },
            FilterExpression: 'activo = :activo',
            Limit: limit,
            ExclusiveStartKey: lastEvaluatedKey
        };
        
        const result = await dynamodb.query(params).promise();
        
        const respuesta = {
            productos: result.Items,
            count: result.Items.length,
            lastEvaluatedKey: result.LastEvaluatedKey ? 
                encodeURIComponent(JSON.stringify(result.LastEvaluatedKey)) : null
        };
        
        return lambdaResponse(200, respuesta);
        
    } catch (error) {
        console.error('Error listando productos:', error);
        if (error.message.includes('Token')) {
            return lambdaResponse(401, { error: error.message });
        }
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

/**
 * CREAR PRODUCTO
 */
export async function crearProducto(event, context) {
    try {
        // Validar token
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const usuario = validarToken(authHeader);
        
        const body = JSON.parse(event.body);
        const tenantId = usuario.tenant_id;
        
        // Validar campos requeridos
        const camposRequeridos = ['nombre', 'descripcion', 'precio', 'categoria', 'laboratorio'];
        for (const campo of camposRequeridos) {
            if (!body[campo]) {
                return lambdaResponse(400, { error: `Campo requerido: ${campo}` });
            }
        }
        
        const codigo = generarCodigoProducto();
        
        const producto = {
            tenant_id: tenantId,
            codigo: codigo,
            nombre: body.nombre,
            descripcion: body.descripcion,
            categoria: body.categoria, // Ej: "Analgésicos", "Antibióticos", "Vitaminas"
            laboratorio: body.laboratorio, // Ej: "Bayer", "Pfizer"
            precio: parseFloat(body.precio),
            stock: parseInt(body.stock) || 0,
            principio_activo: body.principio_activo || '',
            concentracion: body.concentracion || '', // Ej: "500mg"
            forma_farmaceutica: body.forma_farmaceutica || '', // Ej: "Tabletas", "Jarabe"
            presentacion: body.presentacion || '', // Ej: "Caja x 20 tabletas"
            registro_sanitario: body.registro_sanitario || '',
            requiere_receta: body.requiere_receta || false,
            fecha_vencimiento: body.fecha_vencimiento || null,
            contraindicaciones: body.contraindicaciones || '',
            indicaciones: body.indicaciones || '',
            imagen_url: body.imagen_url || '',
            activo: true,
            fecha_creacion: new Date().toISOString(),
            fecha_actualizacion: new Date().toISOString()
        };
        
        await dynamodb.put({
            TableName: tableName,
            Item: producto
        }).promise();
        
        return lambdaResponse(201, {
            message: 'Producto creado exitosamente',
            producto: producto
        });
        
    } catch (error) {
        console.error('Error creando producto:', error);
        if (error.message.includes('Token')) {
            return lambdaResponse(401, { error: error.message });
        }
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

/**
 * BUSCAR PRODUCTO POR CÓDIGO
 */
export async function buscarProducto(event, context) {
    try {
        // Validar token
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const usuario = validarToken(authHeader);
        
        const tenantId = usuario.tenant_id;
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
        
        if (!result.Item.activo) {
            return lambdaResponse(404, { error: 'Producto no disponible' });
        }
        
        return lambdaResponse(200, {
            producto: result.Item
        });
        
    } catch (error) {
        console.error('Error buscando producto:', error);
        if (error.message.includes('Token')) {
            return lambdaResponse(401, { error: error.message });
        }
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

/**
 * MODIFICAR PRODUCTO
 */
export async function modificarProducto(event, context) {
    try {
        // Validar token
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const usuario = validarToken(authHeader);
        
        const tenantId = usuario.tenant_id;
        const codigo = event.pathParameters?.codigo;
        const body = JSON.parse(event.body);
        
        if (!codigo) {
            return lambdaResponse(400, { error: 'Código de producto requerido' });
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
        
        // Construir expression de actualización
        let updateExpression = 'SET fecha_actualizacion = :fecha_actualizacion';
        const expressionAttributeValues = {
            ':fecha_actualizacion': new Date().toISOString()
        };
        const expressionAttributeNames = {};
        
        const camposActualizables = [
            'nombre', 'descripcion', 'categoria', 'laboratorio', 'precio', 'stock',
            'principio_activo', 'concentracion', 'forma_farmaceutica', 'presentacion',
            'registro_sanitario', 'requiere_receta', 'fecha_vencimiento',
            'contraindicaciones', 'indicaciones', 'imagen_url', 'activo'
        ];
        
        camposActualizables.forEach(campo => {
            if (body[campo] !== undefined) {
                updateExpression += `, #${campo} = :${campo}`;
                expressionAttributeNames[`#${campo}`] = campo;
                
                if (campo === 'precio') {
                    expressionAttributeValues[`:${campo}`] = parseFloat(body[campo]);
                } else if (campo === 'stock') {
                    expressionAttributeValues[`:${campo}`] = parseInt(body[campo]);
                } else if (campo === 'requiere_receta' || campo === 'activo') {
                    expressionAttributeValues[`:${campo}`] = Boolean(body[campo]);
                } else {
                    expressionAttributeValues[`:${campo}`] = body[campo];
                }
            }
        });
        
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
            message: 'Producto actualizado exitosamente',
            producto: result.Attributes
        });
        
    } catch (error) {
        console.error('Error modificando producto:', error);
        if (error.message.includes('Token')) {
            return lambdaResponse(401, { error: error.message });
        }
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

/**
 * ELIMINAR PRODUCTO (eliminación lógica)
 */
export async function eliminarProducto(event, context) {
    try {
        // Validar token
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const usuario = validarToken(authHeader);
        
        const tenantId = usuario.tenant_id;
        const codigo = event.pathParameters?.codigo;
        
        if (!codigo) {
            return lambdaResponse(400, { error: 'Código de producto requerido' });
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
        
        // Eliminación lógica (marcar como inactivo)
        const updateParams = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            },
            UpdateExpression: 'SET activo = :activo, fecha_actualizacion = :fecha_actualizacion',
            ExpressionAttributeValues: {
                ':activo': false,
                ':fecha_actualizacion': new Date().toISOString()
            },
            ReturnValues: 'ALL_NEW'
        };
        
        const result = await dynamodb.update(updateParams).promise();
        
        return lambdaResponse(200, {
            message: 'Producto eliminado exitosamente',
            producto: result.Attributes
        });
        
    } catch (error) {
        console.error('Error eliminando producto:', error);
        if (error.message.includes('Token')) {
            return lambdaResponse(401, { error: error.message });
        }
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}