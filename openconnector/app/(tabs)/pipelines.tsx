import { useEffect, useState } from 'react'
import { View, Text, FlatList, ActivityIndicator, RefreshControl, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSession } from '../ctx'
import { api } from '../../lib/api'
import { SymbolView } from 'expo-symbols'

export default function PipelinesScreen() {
  const { location } = useSession()
  const [pipelines, setPipelines] = useState<any[]>([])
  const [activePipeline, setActivePipeline] = useState<any>(null)
  const [opportunities, setOpportunities] = useState<any[]>([])
  
  const [isLoading, setIsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadData = async () => {
    if (!location?.id) return
    try {
      const data = await api.getPipelines(location.id)
      setPipelines(data.pipelines || [])
      if (data.pipelines?.length > 0) {
        const pipeline = data.pipelines[0]
        setActivePipeline(pipeline)
        const oppsData = await api.getOpportunities(location.id, pipeline.id)
        setOpportunities(oppsData.opportunities || [])
      }
    } catch (e) {
      console.warn('Failed to load pipelines', e)
    } finally {
      setIsLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [location?.id])

  const onRefresh = () => {
    setRefreshing(true)
    loadData()
  }

  const renderOpportunity = ({ item }: { item: any }) => {
    return (
      <View className="bg-zinc-900 rounded-xl p-4 mb-3 mx-4 border border-zinc-800">
        <View className="flex-row justify-between mb-2">
          <Text className="text-white font-semibold text-lg">{item.name}</Text>
          <View className={`px-2 py-1 rounded ${item.status === 'open' ? 'bg-blue-600/20' : 'bg-zinc-800'}`}>
            <Text className={`text-xs uppercase font-bold ${item.status === 'open' ? 'text-blue-400' : 'text-zinc-400'}`}>
              {item.status}
            </Text>
          </View>
        </View>
        
        {item.value_cents > 0 && (
          <Text className="text-green-400 font-medium mb-2">
            ${(item.value_cents / 100).toFixed(2)}
          </Text>
        )}

        {item.contact && (
          <View className="flex-row items-center mt-1">
            <SymbolView name="person.fill" size={14} tintColor="#9ca3af" style={{ marginRight: 6 }} />
            <Text className="text-zinc-400 text-sm">
              {item.contact.name || item.contact.phones?.[0] || 'Unknown Contact'}
            </Text>
          </View>
        )}
      </View>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-zinc-950" edges={['top']}>
      <View className="px-4 py-3 border-b border-zinc-800">
        <Text className="text-2xl font-bold text-white">Pipelines</Text>
        {activePipeline && (
          <Text className="text-blue-400 mt-1">{activePipeline.name}</Text>
        )}
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : pipelines.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <SymbolView name="chart.bar.fill" size={48} tintColor="#52525b" />
          <Text className="text-zinc-500 mt-4 text-base">No pipelines found</Text>
        </View>
      ) : (
        <FlatList
          data={opportunities}
          keyExtractor={(item) => item.id}
          renderItem={renderOpportunity}
          className="pt-4"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#3b82f6"
            />
          }
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center pt-20">
              <Text className="text-zinc-500 text-base">No opportunities in this pipeline</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  )
}
